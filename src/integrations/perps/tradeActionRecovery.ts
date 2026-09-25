import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { SolanaRpcError } from '@/integrations/api/signedSolanaRpc';
import {
  readPendingTradeAction,
  removePendingTradeAction,
  type TradeActionScope,
} from '@/integrations/perps/tradeActionStorage';
import {
  readSubmittedTransactionStatus,
  storedLegacyTransactionIsCurrent,
  submitSignedLegacyTransaction,
  TransactionSigningError,
} from '@/integrations/solana/signedLegacyTransaction';
import {
  FAST_DEPOSIT_INSTRUCTION_NAMES,
  submitSignedMultiAuthorityLegacyTransaction,
} from '@/integrations/solana/signedMultiAuthorityLegacyTransaction';
import {
  storedVersionedTransactionIsCurrent,
  submitSignedVersionedTransaction,
} from '@/integrations/solana/signedVersionedTransaction';

export type TradeActionRecoveryStatus =
  | 'none'
  | 'pending'
  | 'indexing'
  | 'confirmed'
  | 'expired';

/**
 * What became of a signed transaction this device submitted, and a rebroadcast if it can still land.
 *
 * Expiry is decided by the transaction's blockhash, never by a clock. It used to be decided by
 * `record.expiresAtMs`, and that number is the *preview's* lifetime — 45 seconds measured from when the
 * plan was built, before the reader had even seen the review. Reading the review, sliding to confirm, a
 * Privy signing round trip, submission and a confirmation window routinely spend more than that, so a
 * transaction that was signed and sent would come back here past its deadline, and this deleted the only
 * record of it and reported `expired`. The panel above turns that into "Transfer expired. Funds
 * unmoved." — a claim about money that nothing had checked, on a transfer that may well have landed.
 *
 * A blockhash is valid for 150 slots from the moment it was fetched, so while it is alive the
 * transaction is landable and worth resending; once it is dead the transaction can never land. Paired
 * with the signature status read above — which has already established the transaction is not on chain —
 * a dead blockhash is a definitive answer rather than a guess, and it is what makes "funds unmoved" true
 * when the panel says it.
 */
export async function reconcilePendingTradeAction(input: {
  readonly owner: string;
  readonly provider: TradeActionScope;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<TradeActionRecoveryStatus> {
  const record = await readPendingTradeAction(input.owner, input.provider);
  if (record === null) return 'none';

  const status = await readSubmittedTransactionStatus({
    rpcUrl: input.rpcUrl,
    signature: record.signature,
    signer: input.signer,
    ...(record.kind === 'fast-collateral'
      ? {
          instructionNames: FAST_DEPOSIT_INSTRUCTION_NAMES,
          operation: 'pacifica_fast_deposit_recovery',
        }
      : {}),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (status === 'confirmed') {
    // A Pacifica collateral transaction is not finished when Solana confirms it. Keep its duplicate
    // lock until the provider balance reflects the exact expected increase; the root settlement monitor
    // owns that second boundary.
    if (tracksPacificaCredit(record)) return 'indexing';
    await removePendingTradeAction(input.owner, input.provider);
    return 'confirmed';
  }
  if (status === 'failed') {
    await removePendingTradeAction(input.owner, input.provider);
    throw new TransactionSigningError(
      'The previous trade preparation transaction failed on-chain.',
      'transaction_failed',
    );
  }

  // Nothing stored to inspect or resend, so the clock is the only bound there is — and here it is only
  // that: a limit on how long an untrackable record may linger, not a verdict on the transfer.
  if (record.signedTransactionBase64 === null) {
    if (Date.now() >= record.expiresAtMs) {
      await removePendingTradeAction(input.owner, input.provider);
      return 'expired';
    }
    return 'pending';
  }

  const versioned = record.kind === 'conversion' || record.kind === 'trade';
  const current = versioned
    ? await storedVersionedTransactionIsCurrent({
        rpcUrl: input.rpcUrl,
        signedTransactionBase64: record.signedTransactionBase64,
        signer: input.signer,
      })
    : await storedLegacyTransactionIsCurrent({
        rpcUrl: input.rpcUrl,
        signedTransactionBase64: record.signedTransactionBase64,
        signer: input.signer,
      });
  if (!current) {
    // `processed` means a node has already observed execution. A dead recent blockhash prevents a new
    // landing, but it does not erase that observation; keep tracking until the cluster resolves it.
    if (status === 'processed') return 'pending';
    await removePendingTradeAction(input.owner, input.provider);
    return 'expired';
  }

  // The original submission already asks each provider for bounded rebroadcasts. This resend covers
  // app/network interruption and carries the record's idempotency key, so it is the same request and
  // exact signed bytes rather than a second financial action.
  try {
    const result = versioned
      ? await submitSignedVersionedTransaction({
          expectedSignature: record.signature,
          idempotencyKey: record.idempotencyKey,
          owner: record.owner,
          rpcUrl: input.rpcUrl,
          signedTransactionBase64: record.signedTransactionBase64,
          signer: input.signer,
        })
      : record.kind === 'fast-collateral'
        ? await submitSignedMultiAuthorityLegacyTransaction({
            expectedSignature: record.signature,
            idempotencyKey: record.idempotencyKey,
            owner: record.owner,
            requestSigner: input.signer,
            rpcUrl: input.rpcUrl,
            signedTransactionBase64: record.signedTransactionBase64,
          })
        : await submitSignedLegacyTransaction({
          expectedSignature: record.signature,
          idempotencyKey: record.idempotencyKey,
          owner: record.owner,
          rpcUrl: input.rpcUrl,
          signedTransactionBase64: record.signedTransactionBase64,
          signer: input.signer,
        });
    if (result.status === 'confirmed') {
      if (tracksPacificaCredit(record)) return 'indexing';
      await removePendingTradeAction(input.owner, input.provider);
      return 'confirmed';
    }
    return 'pending';
  } catch (cause) {
    if (cause instanceof SolanaRpcError && cause.code.startsWith('rpc_-')) {
      await removePendingTradeAction(input.owner, input.provider);
      throw new TransactionSigningError(
        'The stored transaction was rejected before submission.',
        'submission_rejected',
      );
    }
    throw cause;
  }
}

function tracksPacificaCredit(record: {
  readonly expectedProviderCreditBaseUnits?: string | null;
  readonly provider: TradeActionScope;
  readonly providerBalanceBeforeBaseUnits?: string | null;
}): boolean {
  return record.provider === 'pacifica' &&
    typeof record.providerBalanceBeforeBaseUnits === 'string' &&
    typeof record.expectedProviderCreditBaseUnits === 'string';
}
