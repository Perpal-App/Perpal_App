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
  storedVersionedTransactionIsCurrent,
  submitSignedVersionedTransaction,
} from '@/integrations/solana/signedVersionedTransaction';

export type TradeActionRecoveryStatus =
  | 'none'
  | 'pending'
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
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (status === 'confirmed') {
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
    await removePendingTradeAction(input.owner, input.provider);
    return 'expired';
  }

  // Submitted with `maxRetries: 0`, so the node does not rebroadcast on its own and a landable
  // transaction depends on this resend. The idempotency key is the record's, so a repeat is the same
  // request rather than a second one.
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
      : await submitSignedLegacyTransaction({
          expectedSignature: record.signature,
          idempotencyKey: record.idempotencyKey,
          owner: record.owner,
          rpcUrl: input.rpcUrl,
          signedTransactionBase64: record.signedTransactionBase64,
          signer: input.signer,
        });
    if (result.status === 'confirmed') {
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
