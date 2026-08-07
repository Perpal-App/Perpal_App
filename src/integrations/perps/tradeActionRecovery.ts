import type { PerpsProviderId } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  readPendingTradeAction,
  removePendingTradeAction,
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

export async function reconcilePendingTradeAction(input: {
  readonly owner: string;
  readonly provider: PerpsProviderId;
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
  if (record.signedTransactionBase64 !== null && Date.now() < record.expiresAtMs) {
    const current = record.kind === 'conversion'
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
    const result = record.kind === 'conversion'
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
  }
  if (Date.now() >= record.expiresAtMs) {
    await removePendingTradeAction(input.owner, input.provider);
    return 'expired';
  }
  return 'pending';
}
