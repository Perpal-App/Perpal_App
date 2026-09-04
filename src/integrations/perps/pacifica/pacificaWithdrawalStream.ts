const CONNECT_TIMEOUT_MS = 8_000;
const CONFIRMATION_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_LENGTH = 64_000;
const MAX_BUFFERED_CONFIRMATIONS = 16;

export type PacificaWithdrawalConfirmation = {
  readonly account: string;
  readonly amount: string;
  readonly asset: 'USDC';
  readonly batchNonce: string;
  readonly feeAmount: string;
  readonly requestedAmount: string;
  readonly transactionSignature: string;
};

export type PacificaWithdrawalMonitor = {
  readonly close: () => void;
  readonly waitFor: (
    batchNonce: string,
    signal?: AbortSignal,
  ) => Promise<PacificaWithdrawalConfirmation>;
};

/**
 * Opens Pacifica's documented account-transfer stream before a withdrawal is submitted.
 *
 * The stream is authoritative for a live `withdrawal_confirmed` event. It is not a historical
 * status API, so callers must retain their persisted request when the event is missed or times out.
 */
export async function openPacificaWithdrawalMonitor(input: {
  readonly account: string;
  readonly signal?: AbortSignal;
  readonly wsOrigin: string;
}): Promise<PacificaWithdrawalMonitor> {
  if (input.signal?.aborted) throw cancelled();

  return new Promise((resolve, reject) => {
    let settled = false;
    let terminalError: Error | null = null;
    const buffered = new Map<string, PacificaWithdrawalConfirmation>();
    const waiters = new Map<string, {
      readonly reject: (cause: Error) => void;
      readonly resolve: (value: PacificaWithdrawalConfirmation) => void;
    }>();
    const socket = new WebSocket(input.wsOrigin);
    const connectTimer = setTimeout(() => finishOpen(new Error(
      'Pacifica status is unavailable. No withdrawal request was submitted.',
    )), CONNECT_TIMEOUT_MS);

    const close = () => {
      clearTimeout(connectTimer);
      input.signal?.removeEventListener('abort', abort);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      const error = terminalError ?? new Error(
        'Pacifica status disconnected. The withdrawal request remains saved for recovery.',
      );
      for (const waiter of waiters.values()) waiter.reject(error);
      waiters.clear();
    };

    const abort = () => {
      terminalError = cancelled();
      if (!settled) finishOpen(terminalError);
      else close();
    };

    const finishOpen = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      if (error !== undefined) {
        close();
        reject(error);
        return;
      }
      resolve({ close, waitFor });
    };

    const waitFor = (
      batchNonce: string,
      signal?: AbortSignal,
    ): Promise<PacificaWithdrawalConfirmation> => {
      const ready = buffered.get(batchNonce);
      if (ready !== undefined) {
        buffered.delete(batchNonce);
        return Promise.resolve(ready);
      }
      if (terminalError !== null) return Promise.reject(terminalError);
      if (signal?.aborted) return Promise.reject(cancelled());

      return new Promise((resolveWait, rejectWait) => {
        const timeout = setTimeout(() => done(new Error(
          'Pacifica has not confirmed the release yet. The same request is saved; retry Resume later.',
        )), CONFIRMATION_TIMEOUT_MS);
        const abortWait = () => done(cancelled());
        const done = (error?: Error, value?: PacificaWithdrawalConfirmation) => {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abortWait);
          waiters.delete(batchNonce);
          if (error !== undefined) rejectWait(error);
          else if (value !== undefined) resolveWait(value);
        };
        waiters.set(batchNonce, {
          reject: (error) => done(error),
          resolve: (value) => done(undefined, value),
        });
        signal?.addEventListener('abort', abortWait, { once: true });
      });
    };

    socket.onopen = () => {
      socket.send(JSON.stringify({
        method: 'subscribe',
        params: { account: input.account, source: 'account_transfers' },
      }));
      finishOpen();
    };
    socket.onmessage = (event) => {
      const confirmation = parseConfirmation(event.data, input.account);
      if (confirmation === null) return;
      const waiter = waiters.get(confirmation.batchNonce);
      if (waiter !== undefined) {
        waiter.resolve(confirmation);
        return;
      }
      buffered.set(confirmation.batchNonce, confirmation);
      if (buffered.size > MAX_BUFFERED_CONFIRMATIONS) {
        buffered.delete(buffered.keys().next().value as string);
      }
    };
    socket.onerror = () => {
      terminalError = new Error(
        'Pacifica status is unavailable. The withdrawal request remains saved for recovery.',
      );
      if (!settled) finishOpen(terminalError);
      else close();
    };
    socket.onclose = () => {
      terminalError ??= new Error(
        'Pacifica status disconnected. The withdrawal request remains saved for recovery.',
      );
      if (!settled) finishOpen(terminalError);
      else {
        for (const waiter of waiters.values()) waiter.reject(terminalError);
        waiters.clear();
      }
    };
    input.signal?.addEventListener('abort', abort, { once: true });
  });
}

function parseConfirmation(
  raw: unknown,
  expectedAccount: string,
): PacificaWithdrawalConfirmation | null {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_LENGTH) return null;
  try {
    const envelope = JSON.parse(raw) as unknown;
    if (!isRecord(envelope) || envelope.channel !== 'account_transfers') return null;
    const data = envelope.data;
    if (
      !isRecord(data) ||
      data.u !== expectedAccount ||
      data.e !== 'withdrawal_confirmed' ||
      data.a !== 'USDC' ||
      typeof data.am !== 'string' ||
      typeof data.ra !== 'string' ||
      typeof data.f !== 'string' ||
      typeof data.tx !== 'string' ||
      data.tx.length === 0
    ) return null;
    const batchNonce = nonce(data.bn);
    if (batchNonce === null) return null;
    return {
      account: expectedAccount,
      amount: data.am,
      asset: 'USDC',
      batchNonce,
      feeAmount: data.f,
      requestedAmount: data.ra,
      transactionSignature: data.tx,
    };
  } catch {
    return null;
  }
}

function nonce(value: unknown): string | null {
  if (typeof value === 'string' && /^\d+$/u.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cancelled(): Error {
  return new Error('Trading withdrawal cancelled. The saved request was not discarded.');
}
