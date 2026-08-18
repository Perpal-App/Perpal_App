import {
  classifyPrivateFundingFailure,
  PrivateFundingError,
} from '@/integrations/umbra/privateFundingErrors';
import {
  createPrivateFundingRelayer,
  pollPrivateFundingRelay,
} from '@/integrations/umbra/privateFundingRelayer';
import {
  writePrivateFundingRecord,
  type PrivateFundingRecord,
} from '@/integrations/umbra/umbraSecureStorage';

type RelayTarget = {
  readonly leg: 'collateral' | 'fee';
  readonly requestId: string;
};

export function nextPrivateFundingRelayRecoveryAttempt(input: {
  readonly activeRefresh: number;
  readonly isRunning: boolean;
  readonly lastAttemptKey: string | null;
  readonly recoveryKey: string | null;
}): string | null {
  if (input.isRunning || input.recoveryKey === null) {
    return null;
  }

  const attemptKey = `${input.recoveryKey}:${input.activeRefresh}`;
  return attemptKey === input.lastAttemptKey ? null : attemptKey;
}

export function privateFundingRelayRecoveryKey(
  record: PrivateFundingRecord | null,
): string | null {
  if (record === null) {
    return null;
  }
  const target = relayTarget(record);
  return target === null ? null : `${record.id}:${target.leg}:${target.requestId}`;
}

export async function recoverSubmittedPrivateFundingRelay(input: {
  readonly apiEndpoint: string;
  readonly onRecord: (record: PrivateFundingRecord) => void;
  readonly record: PrivateFundingRecord;
  readonly signal: AbortSignal;
}): Promise<PrivateFundingRecord> {
  const target = relayTarget(input.record);

  if (target === null) {
    return input.record;
  }

  const relayer = createPrivateFundingRelayer(input.apiEndpoint, input.signal);

  try {
    const signature = await pollPrivateFundingRelay(
      relayer,
      target.requestId,
      input.signal,
    );
    if (input.signal.aborted) {
      throw new PrivateFundingError('Relay recovery paused.', 'relay_cancelled');
    }
    const next = target.leg === 'collateral'
      ? {
          ...input.record,
          claimSignature: signature,
          phase: 'fee-funding' as const,
          errorCode: null,
          updatedAtMs: Date.now(),
        }
      : completeFeeRelay(input.record, signature);
    await persist(next, input.onRecord);
    return next;
  } catch (cause) {
    if (input.signal.aborted) {
      throw new PrivateFundingError('Relay recovery paused.', 'relay_cancelled');
    }
    const errorCode = classifyPrivateFundingFailure(cause);

    if (errorCode !== 'relay_cancelled' && errorCode !== 'relay_pending') {
      await persist({
        ...input.record,
        errorCode,
        updatedAtMs: Date.now(),
      }, input.onRecord);
    }
    throw cause;
  }
}

function relayTarget(record: PrivateFundingRecord | null): RelayTarget | null {
  if (record === null || record.phase === 'complete') {
    return null;
  }

  if (record.relayRequestId !== null && record.claimSignature === null) {
    return { leg: 'collateral', requestId: record.relayRequestId };
  }

  if (
    record.feeFundingRelayRequestId !== null &&
    record.feeFundingSignature === null
  ) {
    return { leg: 'fee', requestId: record.feeFundingRelayRequestId };
  }

  return null;
}

function completeFeeRelay(
  record: PrivateFundingRecord,
  signature: string,
): PrivateFundingRecord {
  if (record.claimSignature === null) {
    throw new PrivateFundingError(
      'Collateral recovery must complete before the SOL reserve.',
      'recovery_state_invalid',
    );
  }

  return {
    ...record,
    feeFundingSignature: signature,
    phase: 'complete',
    errorCode: null,
    updatedAtMs: Date.now(),
  };
}

async function persist(
  record: PrivateFundingRecord,
  onRecord: (record: PrivateFundingRecord) => void,
): Promise<void> {
  await writePrivateFundingRecord(record);
  onRecord(record);
}
