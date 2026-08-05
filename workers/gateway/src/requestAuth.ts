import {
  buildGatewaySigningMessage,
  gatewayHeaders,
  hexToBytes,
  isValidGatewayNonce,
} from '../../../src/integrations/api/gatewayProtocol';

import type { ResolvedCluster } from './env';
import { RedisStore } from './redisStore';

const AUTH_WINDOW_MS = 60_000;
const NONCE_TTL_SECONDS = 120;

type AuthenticationFailure = {
  readonly ok: false;
  readonly code:
    | 'auth_expired'
    | 'auth_invalid'
    | 'auth_missing'
    | 'replay_detected'
    | 'state_unavailable';
  readonly status: number;
};

export type AuthenticationResult =
  | { readonly ok: true; readonly actorHash: string; readonly bodyHash: string }
  | AuthenticationFailure;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function authenticateRequest({
  body,
  cluster,
  nowMs,
  operation,
  request,
  redis,
}: {
  readonly body: string;
  readonly cluster: ResolvedCluster;
  readonly nowMs: number;
  readonly operation: string;
  readonly request: Request;
  readonly redis: RedisStore;
}): Promise<AuthenticationResult> {
  const network = request.headers.get(gatewayHeaders.network);
  const nonce = request.headers.get(gatewayHeaders.nonce);
  const publicKeyHex = request.headers.get(gatewayHeaders.publicKey);
  const signatureHex = request.headers.get(gatewayHeaders.signature);
  const timestamp = request.headers.get(gatewayHeaders.timestamp);

  if (
    network === null ||
    nonce === null ||
    publicKeyHex === null ||
    signatureHex === null ||
    timestamp === null
  ) {
    return { ok: false, code: 'auth_missing', status: 401 };
  }

  const timestampMs = Number(timestamp);
  const publicKeyBytes = hexToBytes(publicKeyHex, 32);
  const signatureBytes = hexToBytes(signatureHex, 64);

  if (
    network !== cluster ||
    !Number.isSafeInteger(timestampMs) ||
    !isValidGatewayNonce(nonce) ||
    publicKeyBytes === null ||
    signatureBytes === null ||
    operation.length === 0 ||
    operation.length > 96
  ) {
    return { ok: false, code: 'auth_invalid', status: 401 };
  }

  if (Math.abs(nowMs - timestampMs) > AUTH_WINDOW_MS) {
    return { ok: false, code: 'auth_expired', status: 401 };
  }

  const bodyHash = await sha256Hex(body);
  const signingMessage = buildGatewaySigningMessage({
    bodyHash,
    idempotencyKey:
      request.headers.get(gatewayHeaders.idempotencyKey) ?? '',
    network: cluster,
    nonce,
    operation,
    timestamp,
  });

  try {
    const publicKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(publicKeyBytes),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      new Uint8Array(signatureBytes),
      new Uint8Array(signingMessage),
    );

    if (!valid) {
      return { ok: false, code: 'auth_invalid', status: 401 };
    }
  } catch {
    return { ok: false, code: 'auth_invalid', status: 401 };
  }

  const actorHash = await sha256Hex(publicKeyHex);
  const nonceHash = await sha256Hex(nonce);

  try {
    const fresh = await redis.reserve(
      `nonce:${cluster}:${actorHash}:${nonceHash}`,
      '1',
      NONCE_TTL_SECONDS,
    );

    return fresh
      ? { ok: true, actorHash, bodyHash }
      : { ok: false, code: 'replay_detected', status: 409 };
  } catch {
    return { ok: false, code: 'state_unavailable', status: 503 };
  }
}

export async function hashIdempotencyKey(
  cluster: ResolvedCluster,
  actorHash: string,
  idempotencyKey: string,
): Promise<string> {
  return `idempotency:${cluster}:${actorHash}:${await sha256Hex(idempotencyKey)}`;
}
