import {
  getDefaultRelayerDeps,
  getUmbraRelayer,
  type UmbraRelayer,
} from '@umbra-privacy/sdk/relayer';

import {
  isGroth16ProofVerificationFailure,
  PrivateFundingError,
  privateFundingFailureDiagnostic,
} from '@/integrations/umbra/privateFundingErrors';

const REQUEST_TIMEOUT_MS = 15_000;
export const PRIVATE_FUNDING_RELAY_POLL_INTERVAL_MS = 3_000;
export const PRIVATE_FUNDING_RELAY_TIMEOUT_MS = 300_000;
const POLL_ATTEMPTS = Math.ceil(
  PRIVATE_FUNDING_RELAY_TIMEOUT_MS / PRIVATE_FUNDING_RELAY_POLL_INTERVAL_MS,
);

export function createPrivateFundingRelayer(
  apiEndpoint: string,
  signal?: AbortSignal,
): UmbraRelayer {
  const defaults = getDefaultRelayerDeps();
  const boundedFetch: typeof globalThis.fetch = async (resource, options) => {
    const controller = new AbortController();
    const callerSignal = options?.signal;
    const abort = () => controller.abort();
    callerSignal?.addEventListener('abort', abort, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (callerSignal?.aborted === true || signal?.aborted === true) {
      abort();
    }
    const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);

    try {
      return await defaults.fetch(resource, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abort);
      signal?.removeEventListener('abort', abort);
    }
  };

  return getUmbraRelayer(
    { apiEndpoint },
    { ...defaults, fetch: boundedFetch },
  );
}

export async function pollPrivateFundingRelay(
  relayer: UmbraRelayer,
  requestId: string,
  signal?: AbortSignal,
): Promise<string> {
  const startedAtMs = performance.now();
  let previousStatus: string | null = null;

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    assertNotAborted(signal);
    const status = await relayer.pollClaimStatus(requestId);

    if (status.status !== previousStatus) {
      previousStatus = status.status;
      console.info('[Perpal Umbra relayer]', JSON.stringify({
        attempt: attempt + 1,
        durationMs: Math.round(performance.now() - startedAtMs),
        event: 'status_changed',
        status: status.status,
      }));
    }

    if (status.status === 'completed') {
      if (status.txSignature === undefined) {
        throw privateFundingRelayFailure(
          status.failureReason,
          status.status,
        );
      }
      return status.txSignature;
    }

    if (['failed', 'timed_out', 'refunded'].includes(status.status)) {
      throw privateFundingRelayFailure(status.failureReason, status.status);
    }

    if (attempt + 1 < POLL_ATTEMPTS) {
      await wait(PRIVATE_FUNDING_RELAY_POLL_INTERVAL_MS, signal);
    }
  }

  throw new PrivateFundingError('Umbra relayer is still processing.', 'relay_pending');
}

export function privateFundingRelayFailure(
  reason: unknown,
  terminalStatus: string,
): PrivateFundingError {
  const errorCode = isGroth16ProofVerificationFailure(reason)
    ? 'proof_verification_failed'
    : 'relay_failed';
  console.error('[Perpal Umbra relayer]', JSON.stringify({
    diagnostic: privateFundingFailureDiagnostic(reason),
    errorCode,
    event: 'terminal_failure',
    terminalStatus,
  }));
  return new PrivateFundingError(
    'Umbra relayer did not complete the private claim.',
    errorCode,
  );
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new PrivateFundingError('Relay recovery paused.', 'relay_cancelled');
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new PrivateFundingError('Relay recovery paused.', 'relay_cancelled'));
      return;
    }
    const complete = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = setTimeout(complete, ms);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(new PrivateFundingError('Relay recovery paused.', 'relay_cancelled'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
