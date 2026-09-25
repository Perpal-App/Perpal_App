import type { PrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';

/**
 * One automatic Pacifica continuation per restored/foreground checkpoint.
 *
 * A persisted provider transaction that is merely pending is always safe to reconcile: it reuses the
 * same signature and idempotency key. An unsigned handoff is attempted when no error exists, or when the
 * only error says the confirmed claim was not visible yet. Definite signing/submission failures remain
 * behind the explicit Resume control rather than causing repeated local signing attempts.
 */
export function automaticProviderContinuationKey(
  record: PrivateFundingRecord | null,
  attemptGeneration: string,
): string | null {
  if (
    record === null ||
    record.destination !== 'pacifica' ||
    record.phase === 'complete' ||
    record.claimSignature === null ||
    record.feeFundingSignature === null
  ) return null;

  const retryable = record.errorCode === null || [
    'pacifica_deposit_pending',
    'pacifica_deposit_indexing',
    'pacifica_deposit_insufficient_usdc',
    'pacifica_deposit_prepare_failed',
  ].includes(record.errorCode);
  if (!retryable) return null;

  return `${record.id}:${attemptGeneration}`;
}
