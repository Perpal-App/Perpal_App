import { ed25519 } from '@noble/curves/ed25519.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';
import { fetch } from 'expo/fetch';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';

const API_PREFIX = '/api/v1';
const EXPIRY_WINDOW_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 10_000;

export class PacificaApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = 'PacificaApiError';
  }
}

type PacificaGetInput = {
  readonly apiOrigin: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
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
  return requestEnvelope(url, { method: 'GET' }, input.signal);
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

  const timestamp = Date.now();
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
  return envelope.data as T;
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
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    const response = await fetch(url.toString(), {
      ...init,
      headers: { accept: 'application/json', ...init.headers },
      signal: controller.signal,
    });
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new PacificaApiError('Pacifica response exceeded the size limit.', 'response_too_large', response.status);
    }
    const value = text.length === 0 ? null : JSON.parse(text) as unknown;
    const envelope = record(value);
    if (!response.ok || envelope.success !== true) {
      throw new PacificaApiError(
        typeof envelope.error === 'string' ? envelope.error : 'Pacifica request failed.',
        String(envelope.code ?? 'pacifica_error'),
        response.status,
      );
    }
    return envelope;
  } catch (cause) {
    if (cause instanceof PacificaApiError) throw cause;
    if (cause instanceof SyntaxError) {
      throw new PacificaApiError('Pacifica returned invalid JSON.', 'response_invalid', 0);
    }
    throw new PacificaApiError(
      cause instanceof Error && cause.name === 'AbortError'
        ? 'Pacifica request timed out.'
        : 'Pacifica is unreachable.',
      cause instanceof Error && cause.name === 'AbortError' ? 'request_timeout' : 'network_error',
      0,
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

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PacificaApiError('Pacifica returned an invalid response.', 'response_invalid', 0);
  }
  return value as Record<string, unknown>;
}
