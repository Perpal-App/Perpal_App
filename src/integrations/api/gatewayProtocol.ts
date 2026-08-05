export const GATEWAY_AUTH_VERSION = 'perpal.gateway.v1';

export const gatewayHeaders = {
  idempotencyKey: 'x-perpal-idempotency-key',
  network: 'x-perpal-network',
  nonce: 'x-perpal-nonce',
  publicKey: 'x-perpal-public-key',
  signature: 'x-perpal-signature',
  timestamp: 'x-perpal-timestamp',
} as const;

export type GatewaySigningInput = {
  readonly bodyHash: string;
  readonly idempotencyKey: string;
  readonly network: 'devnet' | 'mainnet';
  readonly nonce: string;
  readonly operation: string;
  readonly timestamp: string;
};

/** Canonical bytes signed by the anonymous trading key for every gateway call. */
export function buildGatewaySigningMessage(input: GatewaySigningInput): Uint8Array {
  return new TextEncoder().encode(
    [
      GATEWAY_AUTH_VERSION,
      input.timestamp,
      input.nonce,
      input.network,
      input.operation,
      input.bodyHash,
      input.idempotencyKey,
    ].join('\n'),
  );
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(value: string, expectedBytes: number): Uint8Array | null {
  if (
    value.length !== expectedBytes * 2 ||
    !/^[0-9a-f]+$/u.test(value)
  ) {
    return null;
  }

  const bytes = new Uint8Array(expectedBytes);

  for (let index = 0; index < expectedBytes; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

export function isValidGatewayNonce(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/u.test(value);
}

/** Reads the single JSON-RPC operation that the gateway will authenticate. */
export function parseGatewayRpcOperation(body: string): string | null {
  try {
    const value = JSON.parse(body) as unknown;

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }

    const method = (value as Record<string, unknown>).method;
    return typeof method === 'string' && method.length > 0 ? method : null;
  } catch {
    return null;
  }
}
