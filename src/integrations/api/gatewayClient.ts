import * as Crypto from 'expo-crypto';

import type { SolanaCluster } from '@/config/appConfig';
import {
  buildGatewaySigningMessage,
  bytesToHex,
  gatewayHeaders,
} from '@/integrations/api/gatewayProtocol';

const DEFAULT_TIMEOUT_MS = 8_000;

export type GatewayRequestSigner = {
  /** Raw 32-byte ed25519 public key for the anonymous trading wallet. */
  readonly publicKey: Uint8Array;
  readonly sign: (message: Uint8Array) => Promise<Uint8Array>;
};

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

type SignedGatewayRequest = {
  readonly body: unknown;
  readonly cluster: SolanaCluster;
  readonly operation: string;
  readonly signer: GatewayRequestSigner;
  readonly url: string;
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

type GatewayHeaderRequest = {
  readonly body: string;
  readonly cluster: SolanaCluster;
  readonly operation: string;
  readonly signer: GatewayRequestSigner;
  readonly idempotencyKey?: string;
  readonly useBodyHashAsIdempotencyKey?: boolean;
};

/** Signs an already-serialized body without changing the bytes sent on the wire. */
export async function createGatewayRequestHeaders({
  body,
  cluster,
  operation,
  signer,
  idempotencyKey: suppliedIdempotencyKey,
  useBodyHashAsIdempotencyKey = false,
}: GatewayHeaderRequest): Promise<Record<string, string>> {
  if (signer.publicKey.length !== 32) {
    throw new GatewayError('Trading signer is unavailable.', 0, 'signer_invalid');
  }

  const bodyHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    body,
  );
  const idempotencyKey = useBodyHashAsIdempotencyKey
    ? bodyHash
    : suppliedIdempotencyKey;
  const timestamp = Date.now().toString();
  const nonce = Crypto.randomUUID();
  const signature = await signer.sign(
    buildGatewaySigningMessage({
      bodyHash,
      idempotencyKey: idempotencyKey ?? '',
      network: cluster,
      nonce,
      operation,
      timestamp,
    }),
  );

  if (signature.length !== 64) {
    throw new GatewayError('Trading signature is invalid.', 0, 'signature_invalid');
  }

  return {
    'content-type': 'application/json',
    [gatewayHeaders.network]: cluster,
    [gatewayHeaders.nonce]: nonce,
    [gatewayHeaders.publicKey]: bytesToHex(signer.publicKey),
    [gatewayHeaders.signature]: bytesToHex(signature),
    [gatewayHeaders.timestamp]: timestamp,
    ...(idempotencyKey
      ? { [gatewayHeaders.idempotencyKey]: idempotencyKey }
      : {}),
  };
}

/**
 * Sends one signed, abortable request to the gateway.
 *
 * The caller supplies T's session-scoped signer; this module never reads or
 * persists the key. Retries belong to the operation owner because writes require
 * the same explicit idempotency key and signed transaction bytes.
 */
export async function postSignedGatewayRequest<T>({
  body: bodyValue,
  cluster,
  operation,
  signer,
  url,
  idempotencyKey,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}: SignedGatewayRequest): Promise<T> {
  const body = JSON.stringify(bodyValue);
  const headers = await createGatewayRequestHeaders({
    body,
    cluster,
    operation,
    signer,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  if (signal?.aborted) {
    controller.abort();
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | T
      | null;

    if (!response.ok) {
      const error = payload as { error?: { code?: string; message?: string } } | null;
      throw new GatewayError(
        error?.error?.message ?? 'Gateway request failed.',
        response.status,
        error?.error?.code ?? 'gateway_error',
      );
    }

    return payload as T;
  } catch (cause) {
    if (cause instanceof GatewayError) {
      throw cause;
    }

    throw new GatewayError(
      cause instanceof Error && cause.name === 'AbortError'
        ? 'Gateway request timed out.'
        : 'Gateway is unreachable.',
      0,
      cause instanceof Error && cause.name === 'AbortError'
        ? 'request_timeout'
        : 'network_error',
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
