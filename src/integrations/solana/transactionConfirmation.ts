import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { TransactionSigningError } from '@/integrations/solana/transactionSigningError';

/**
 * How long a submission keeps asking whether its signature landed.
 *
 * A deadline, not the attempt count both callers used to carry. Ten attempts at a 1,200ms interval is
 * twelve seconds only if a status read is free; each one is a signed gateway round trip, so on a slow
 * network the attempts were spent in half the wall time the interval implied and the caller was told the
 * transfer was still in flight while it was seconds from confirming.
 *
 * Twenty seconds covers a `confirmed` commitment with room for a congested slot. It is deliberately not
 * the whole life of the transaction: past this the caller gets a `submitted` answer and is expected to
 * keep watching in the background rather than hold its UI open.
 */
const CONFIRMATION_WINDOW_MS = 20_000;
const CONFIRMATION_INTERVAL_MS = 1_200;

/**
 * Consecutive unreadable status polls tolerated before the caller is told it is still in flight.
 *
 * The legacy path treated this as one: a single rate-limited or timed-out read ended the loop and
 * returned `submitted`, so the usual reason a confirmation was abandoned was not a slow transaction but
 * one unlucky request. The versioned path did not catch at all and turned the same blip into a thrown
 * error on a transaction that was fine. A read failure says nothing about whether the transaction
 * landed, so it decides nothing here beyond costing one attempt.
 */
const CONFIRMATION_READ_FAILURES = 4;

/**
 * Provider-side rebroadcasts requested for an accepted signed transaction.
 *
 * `0` made every provider try the transaction once and forget it. The gateway broadcasts writes to all
 * configured providers, but a node can still lose an accepted packet before the current leader sees it;
 * recovery then repeats the same idempotency key and correctly receives the cached first response rather
 * than a second dispatch. Asking each provider for a small bounded retry budget on the original request
 * is therefore what keeps the one idempotent submission alive — not a second client submission.
 */
export const SEND_TRANSACTION_MAX_RETRIES = 5;

export type SubmittedTransactionResult = {
  readonly signature: string;
  readonly status: 'confirmed' | 'submitted' | 'unknown';
};

export type TransactionFailureDiagnostic = {
  readonly customCode?: number;
  readonly errorType: string;
  readonly instructionIndex?: number;
  readonly instructionName?: string;
  readonly kind: 'instruction' | 'transaction';
};

export type SubmittedTransactionStatus =
  | 'confirmed'
  | 'failed'
  | 'processed'
  | 'not-found';

/**
 * What the cluster currently says about one signature.
 *
 * `not-found` and `processed` remain distinct because an expired blockhash proves safety only for a
 * signature the cluster never observed. A processed transaction may still settle after its blockhash can
 * no longer be used for a new landing, so recovery must keep tracking it.
 */
export async function readSubmittedTransactionStatus(input: {
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
  readonly signature: string;
  readonly signal?: AbortSignal;
  /** Safe labels for known top-level instruction positions; no account data is logged. */
  readonly instructionNames?: readonly string[];
  readonly operation?: string;
}): Promise<SubmittedTransactionStatus> {
  const result = await signedSolanaRpc<{
    readonly context: { readonly slot: number };
    readonly value: readonly (
      | { readonly err: unknown; readonly confirmationStatus?: string }
      | null
    )[];
  }>({
    method: 'getSignatureStatuses',
    params: [[input.signature], { searchTransactionHistory: true }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const status = result.value[0];

  if (status === null || status === undefined) return 'not-found';
  if (status.err !== null && status.err !== undefined) {
    console.error('[Perpal transaction failed]', JSON.stringify({
      event: 'transaction_failed',
      operation: input.operation ?? 'transaction',
      ...failureDiagnostic(status.err, input.instructionNames),
    }));
    return 'failed';
  }
  if (
    status.confirmationStatus === 'confirmed' ||
    status.confirmationStatus === 'finalized'
  ) {
    return 'confirmed';
  }
  return 'processed';
}

/**
 * Polls one signature to a verdict, or to `submitted` if the window closes first.
 *
 * One implementation for the legacy and versioned paths, which had a copy each and had already drifted
 * apart in how they handled a read failure. A confirmation loop is the last thing that should exist
 * twice: it is the step that decides whether the caller believes money moved.
 *
 * `submitted` is not a failure and must not be reported as one. It means the question is still open, and
 * the caller's job from there is to keep asking — see `useDirectWithdrawalRecovery`, where a transfer
 * left in that state is watched until the signature status or its blockhash settles it.
 */
export async function confirmSignature(input: {
  readonly failureMessage: string;
  readonly instructionNames?: readonly string[];
  readonly operation?: string;
  readonly rpcUrl: string;
  readonly signature: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<'confirmed' | 'submitted'> {
  const deadline = Date.now() + CONFIRMATION_WINDOW_MS;
  let readFailures = 0;

  while (Date.now() < deadline) {
    if (input.signal?.aborted) return 'submitted';

    try {
      const status = await readSubmittedTransactionStatus({
        rpcUrl: input.rpcUrl,
        signature: input.signature,
        signer: input.signer,
        ...(input.instructionNames === undefined
          ? {}
          : { instructionNames: input.instructionNames }),
        ...(input.operation === undefined ? {} : { operation: input.operation }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });

      if (status === 'failed') {
        throw new TransactionSigningError(input.failureMessage, 'transaction_failed');
      }
      if (status === 'confirmed') return 'confirmed';
      readFailures = 0;
    } catch (cause) {
      // An on-chain failure is an answer and ends the loop. Anything else is the gateway or the network.
      if (cause instanceof TransactionSigningError) throw cause;

      readFailures += 1;
      if (readFailures >= CONFIRMATION_READ_FAILURES) return 'submitted';
    }

    await waitForNextStatus(input.signal);
  }

  return 'submitted';
}

function failureDiagnostic(
  value: unknown,
  instructionNames?: readonly string[],
): TransactionFailureDiagnostic {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const instruction = (value as Record<string, unknown>).InstructionError;
    if (
      Array.isArray(instruction) &&
      instruction.length >= 2 &&
      Number.isSafeInteger(instruction[0]) &&
      Number(instruction[0]) >= 0
    ) {
      const instructionIndex = Number(instruction[0]);
      const detail = instruction[1];
      const custom = typeof detail === 'object' && detail !== null && !Array.isArray(detail)
        ? (detail as Record<string, unknown>).Custom
        : undefined;
      const customCode = Number.isSafeInteger(custom) && Number(custom) >= 0
        ? Number(custom)
        : undefined;
      return {
        ...(customCode === undefined ? {} : { customCode }),
        errorType: customCode === undefined ? safeErrorType(detail) : 'Custom',
        instructionIndex,
        ...(instructionNames?.[instructionIndex] === undefined
          ? {}
          : { instructionName: instructionNames[instructionIndex] }),
        kind: 'instruction',
      };
    }
  }
  return { errorType: safeErrorType(value), kind: 'transaction' };
}

function safeErrorType(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 64);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.keys(value)[0]?.slice(0, 64) ?? 'unknown';
  }
  return 'unknown';
}

function waitForNextStatus(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };

    timer = setTimeout(finish, CONFIRMATION_INTERVAL_MS);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
