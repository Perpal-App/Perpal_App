import { ed25519 } from '@noble/curves/ed25519.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';
import { fetch } from 'expo/fetch';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  clearPacificaReadCache,
  coordinatePacificaRead,
  pacificaReadCooldownMs,
  recordPacificaReadRateLimit,
} from '@/integrations/perps/pacifica/pacificaReadCoordinator';

const API_PREFIX = '/api/v1';
/**
 * How long Pacifica honours a signature after its timestamp. Longer than the request timeout below, so a
 * request that is still allowed to be in flight is never one the venue has stopped accepting — at 5s a
 * slow mobile round trip could outlive its own signature.
 */
const EXPIRY_WINDOW_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 10_000;
const UTF8_ENCODER = new TextEncoder();
/** A difference from Pacifica's clock smaller than this is noise in the estimate, not drift. */
const CLOCK_TOLERANCE_MS = 1_500;

/**
 * How far Pacifica's clock is ahead of this device's, as far as the device can tell: the time the venue's
 * responses are stamped with, less the device's own clock when they arrive.
 *
 * A signed request carries a timestamp that Pacifica checks against its own clock. A device whose clock has
 * fallen behind — an emulator after its host slept, a phone whose time was set by hand — signed requests the
 * venue already held to be expired, so every order and every close failed with "signature expired". Signing
 * on the venue's clock makes a request exactly as fresh as the moment it was signed, whatever the device's
 * own clock says.
 *
 * Read from the `Date` header every response carries. It has one-second resolution and is truncated, and the
 * response has travelled since, so the estimate runs slightly behind the venue: the safe side, as a timestamp
 * is never put in Pacifica's future. Under `CLOCK_TOLERANCE_MS` it counts as none, and a device whose clock is
 * right signs on it exactly as before.
 */
let clockOffsetMs = 0;

/** Now, on Pacifica's clock: what its signatures are timed by and its timestamps are compared with. */
export function pacificaNow(): number {
  return Date.now() + clockOffsetMs;
}

function learnClock(response: Response, receivedAtMs: number): void {
  const stamped = response.headers.get('date');
  if (stamped === null) return;
  const venueMs = Date.parse(stamped);
  if (!Number.isFinite(venueMs)) return;
  const offset = venueMs - receivedAtMs;
  clockOffsetMs = Math.abs(offset) < CLOCK_TOLERANCE_MS ? 0 : offset;
}

/** The venue's own words for a signature that reached it too late, on its clock. */
function isExpiredSignature(cause: unknown): cause is PacificaApiError {
  return cause instanceof PacificaApiError && /signature expired/iu.test(cause.message);
}

export class PacificaApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly requestPath: string | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'PacificaApiError';
  }
}

type PacificaGetInput = {
  readonly apiOrigin: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly freshness?: 'cached' | 'network';
  readonly signal?: AbortSignal | undefined;
};

export type PacificaPage<T> = {
  readonly data: T;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
};

export async function pacificaGet<T>(input: PacificaGetInput): Promise<T> {
  const envelope = await getEnvelope(input);
  return envelope.data as T;
}

export async function pacificaGetPage<T>(input: PacificaGetInput): Promise<PacificaPage<T>> {
  const envelope = await getEnvelope(input);
  const hasMore = envelope.has_more === true;
  const nextCursor = typeof envelope.next_cursor === 'string' && envelope.next_cursor.length > 0
    ? envelope.next_cursor
    : null;
  if (hasMore && nextCursor === null) {
    throw new PacificaApiError(
      'Pacifica returned invalid pagination data.',
      'response_invalid',
      0,
    );
  }
  return { data: envelope.data as T, hasMore, nextCursor };
}

async function getEnvelope(input: PacificaGetInput): Promise<Record<string, unknown>> {
  const url = endpoint(input.apiOrigin, input.path);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    url.searchParams.set(key, value);
  }
  if (input.signal?.aborted === true) throw cancelledRequest(url.pathname);
  const rateLimitScope = url.searchParams.has('account')
    ? `${url.origin}:account`
    : `${url.origin}:${url.pathname}`;

  const request = coordinatePacificaRead({
    allowCached: input.freshness !== 'network',
    cacheKey: url.toString(),
    maxAgeMs: readCacheMaxAgeMs(url.pathname),
    read: async () => {
      const cooldownMs = pacificaReadCooldownMs(rateLimitScope);
      if (cooldownMs > 0) {
        throw new PacificaApiError(
          'Pacifica is temporarily rate-limited.',
          'rate_limited',
          429,
          url.pathname,
          cooldownMs,
        );
      }
      try {
        return await requestEnvelope(url, { method: 'GET' });
      } catch (cause) {
        if (cause instanceof PacificaApiError && cause.status === 429) {
          const retryAfterMs = recordPacificaReadRateLimit(
            rateLimitScope,
            cause.retryAfterMs,
          );
          throw new PacificaApiError(
            'Pacifica is temporarily rate-limited.',
            'rate_limited',
            429,
            url.pathname,
            retryAfterMs,
          );
        }
        throw cause;
      }
    },
  });
  return waitForPacificaRead(request, input.signal, url.pathname);
}

export async function pacificaPostSigned<T>(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly operation: PacificaOperation;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal | undefined;
}): Promise<T> {
  if (
    input.signer.publicKey.length !== 32 ||
    base58.encode(input.signer.publicKey) !== input.account
  ) {
    throw new PacificaApiError(
      'The private trading identity does not match the Pacifica signer.',
      'signer_mismatch',
      0,
    );
  }

  try {
    return await postSignedOnce<T>(input);
  } catch (cause) {
    if (!isExpiredSignature(cause)) throw cause;
    // Rejected for its timestamp alone, which the venue checks before it acts on anything, so nothing was
    // done and sending again cannot do anything twice. The rejection's own response has just set the clock
    // right, so it is signed afresh on the venue's time and sent once more. Only once: a second expiry is
    // not a clock that one reading can fix.
    try {
      return await postSignedOnce<T>(input);
    } catch (retried) {
      if (!isExpiredSignature(retried)) throw retried;
      throw new PacificaApiError(
        'Pacifica says the signature expired. Set the time automatically and retry.',
        'signature_expired',
        retried.status,
        retried.requestPath,
      );
    }
  }
}

/** One signature, one request. The timestamp is taken on the venue's clock, immediately before signing. */
async function postSignedOnce<T>(input: Parameters<typeof pacificaPostSigned>[0]): Promise<T> {
  const timestamp = pacificaNow();
  const signedValue = {
    data: input.payload,
    expiry_window: EXPIRY_WINDOW_MS,
    timestamp,
    type: input.operation,
  };
  const message = utf8ToBytes(canonicalJson(signedValue));
  const signature = await input.signer.sign(message);
  if (
    signature.length !== 64 ||
    !ed25519.verify(signature, message, input.signer.publicKey)
  ) {
    throw new PacificaApiError(
      'Private trading returned an invalid Pacifica signature.',
      'signature_invalid',
      0,
    );
  }

  const body = JSON.stringify({
    account: input.account,
    signature: base58.encode(signature),
    timestamp,
    expiry_window: EXPIRY_WINDOW_MS,
    ...input.payload,
  });
  const envelope = await requestEnvelope(
    endpoint(input.apiOrigin, `/${operationPath(input.operation)}`),
    { method: 'POST', body, headers: { 'content-type': 'application/json' } },
    input.signal,
  );
  clearPacificaReadCache();
  return envelope.data as T;
}

export function isPacificaRateLimited(cause: unknown): cause is PacificaApiError {
  return cause instanceof PacificaApiError && cause.status === 429;
}

export function pacificaRetryDelay(
  cause: unknown,
  attempt: number,
  baseMs = 5_000,
  maxMs = 60_000,
): number {
  if (isPacificaRateLimited(cause)) {
    return Math.min(maxMs, Math.max(baseMs, cause.retryAfterMs ?? 30_000));
  }
  const exponential = Math.min(maxMs, baseMs * (2 ** Math.min(attempt - 1, 3)));
  return Math.round(exponential * (0.8 + Math.random() * 0.4));
}

export type PacificaOperation =
  | 'create_market_order'
  | 'create_order'
  | 'create_stop_order'
  | 'cancel_order'
  | 'update_leverage'
  | 'update_margin_mode'
  | 'withdraw';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

async function requestEnvelope(
  url: URL,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    const response = await fetch(url.toString(), {
      ...init,
      headers: { accept: 'application/json', ...init.headers },
      signal: controller.signal,
    });
    // Every answer, a refusal included, says what time the venue thinks it is.
    learnClock(response, Date.now());
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      /^\d+$/u.test(declaredLength) &&
      Number(declaredLength) > MAX_RESPONSE_BYTES
    ) {
      throw responseError(
        'Pacifica response exceeded the size limit.',
        'response_too_large',
        response,
        url,
      );
    }

    const text = await response.text();
    // UTF-8 is at most four bytes per UTF-16 code unit. Most Pacifica JSON is far below one quarter of
    // the cap, so it cannot exceed the byte bound and does not need a second full response allocation.
    const canExceedByteLimit = text.length > MAX_RESPONSE_BYTES / 4;
    if (
      text.length > MAX_RESPONSE_BYTES ||
      (canExceedByteLimit && UTF8_ENCODER.encode(text).byteLength > MAX_RESPONSE_BYTES)
    ) {
      throw responseError(
        'Pacifica response exceeded the size limit.',
        'response_too_large',
        response,
        url,
      );
    }

    if (text.trim().length === 0) {
      throw responseError(
        response.ok
          ? 'Pacifica returned an empty response.'
          : `Pacifica request returned HTTP ${response.status}.`,
        response.ok ? 'response_empty' : 'http_error',
        response,
        url,
      );
    }

    if (!isJsonContentType(response.headers.get('content-type'))) {
      throw responseError(
        response.ok
          ? 'Pacifica returned an unsupported response type.'
          : `Pacifica request returned HTTP ${response.status}.`,
        response.ok ? 'response_content_type_invalid' : 'http_error',
        response,
        url,
      );
    }

    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw responseError(
        response.ok
          ? 'Pacifica returned invalid JSON.'
          : `Pacifica request returned HTTP ${response.status}.`,
        response.ok ? 'response_invalid' : 'http_error',
        response,
        url,
      );
    }

    if (!isRecord(value)) {
      throw responseError(
        response.ok
          ? 'Pacifica returned an invalid response.'
          : `Pacifica request returned HTTP ${response.status}.`,
        response.ok ? 'response_invalid' : 'http_error',
        response,
        url,
      );
    }

    const envelope = value;
    if (!response.ok || envelope.success !== true) {
      const upstream = pacificaFailure(envelope);
      if (response.status === 429) {
        throw new PacificaApiError(
          'Pacifica is temporarily rate-limited.',
          'rate_limited',
          429,
          url.pathname,
          retryAfterMs(response.headers.get('retry-after')),
        );
      }
      throw new PacificaApiError(
        upstream.message,
        upstream.code,
        response.status,
        url.pathname,
      );
    }
    return envelope;
  } catch (cause) {
    if (cause instanceof PacificaApiError) throw cause;
    const cancelled = signal?.aborted === true;
    const requestTimedOut = timedOut && !cancelled;
    throw new PacificaApiError(
      cancelled
        ? 'Pacifica request was cancelled.'
        : requestTimedOut
          ? 'Pacifica request timed out.'
          : 'Pacifica is unreachable.',
      cancelled ? 'request_cancelled' : requestTimedOut ? 'request_timeout' : 'network_error',
      0,
      url.pathname,
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function endpoint(origin: string, path: string): URL {
  if (!path.startsWith('/')) throw new Error('Pacifica API path must be absolute.');
  return new URL(`${API_PREFIX}${path}`, origin);
}

function operationPath(operation: PacificaOperation): string {
  switch (operation) {
    case 'create_market_order': return 'orders/create_market';
    case 'create_order': return 'orders/create';
    case 'create_stop_order': return 'orders/stop/create';
    case 'cancel_order': return 'orders/cancel';
    case 'update_leverage': return 'account/leverage';
    case 'update_margin_mode': return 'account/margin';
    case 'withdraw': return 'account/withdraw';
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pacificaFailure(envelope: Record<string, unknown>): {
  readonly code: string;
  readonly message: string;
} {
  const nested = isRecord(envelope.error) ? envelope.error : null;
  const message = boundedText(envelope.error, 240)
    ?? boundedText(nested?.message, 240)
    ?? boundedText(envelope.message, 240)
    ?? 'Pacifica request failed.';
  const code = boundedText(envelope.code, 80)
    ?? boundedText(nested?.code, 80)
    ?? 'pacifica_error';
  return { code, message };
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function responseError(
  message: string,
  code: string,
  response: Response,
  url: URL,
): PacificaApiError {
  if (response.status === 429) {
    return new PacificaApiError(
      'Pacifica is temporarily rate-limited.',
      'rate_limited',
      429,
      url.pathname,
      retryAfterMs(response.headers.get('retry-after')),
    );
  }
  return new PacificaApiError(message, code, response.status, url.pathname);
}

function readCacheMaxAgeMs(path: string): number {
  if (
    path === '/api/v1/trades/history' ||
    path === '/api/v1/account/balance/history' ||
    path === '/api/v1/orders/history'
  ) return 60_000;
  if (
    path === '/api/v1/account' ||
    path === '/api/v1/positions' ||
    path === '/api/v1/orders'
  ) return 15_000;
  return 0;
}

function retryAfterMs(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function waitForPacificaRead<T>(
  request: Promise<T>,
  signal: AbortSignal | undefined,
  requestPath: string,
): Promise<T> {
  if (signal === undefined) return request;
  if (signal.aborted) return Promise.reject(cancelledRequest(requestPath));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const complete = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => complete(() => reject(cancelledRequest(requestPath)));
    signal.addEventListener('abort', abort, { once: true });
    // Supplying both callbacks means this observer is always fulfilled. The previous `.finally()`
    // created a second, unobserved rejected promise whenever Pacifica timed out or the screen aborted
    // its refresh, which React Native correctly surfaced as an uncaught error.
    void request.then(
      (value) => complete(() => resolve(value)),
      (cause) => complete(() => reject(cause)),
    );
  });
}

function cancelledRequest(requestPath: string): PacificaApiError {
  return new PacificaApiError(
    'Pacifica request was cancelled.',
    'request_cancelled',
    0,
    requestPath,
  );
}
