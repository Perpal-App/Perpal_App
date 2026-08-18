import { base58 } from '@scure/base';

import type { GatewayConfig } from './env';
import { errorResponse, JSON_HEADERS } from './gatewayResponses';

export const SWAP_BUILD_PATH = '/v1/swap/build';

const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_U64 = (1n << 64n) - 1n;

type SwapBuildPayload = {
  readonly amount: string;
  readonly inputMint: string;
  readonly outputMint: string;
  readonly taker: string;
};

export async function handleSwapBuildRequest(input: {
  readonly actorPublicKey: Uint8Array;
  readonly config: NonNullable<GatewayConfig['jupiter']>;
  readonly payload: unknown;
  readonly traceId: string;
}): Promise<{
  readonly response: Response;
  readonly outcome: 'ok' | 'error' | 'rejected';
  readonly upstreamMs?: number;
}> {
  const payload = parsePayload(input.payload, input.config.stablecoinMints);

  if (payload === null || !sameBytes(base58.decode(payload.taker), input.actorPublicKey)) {
    return {
      response: errorResponse(
        400,
        'swap_request_invalid',
        'Stablecoin conversion request is invalid.',
        input.traceId,
      ),
      outcome: 'rejected',
    };
  }

  const url = new URL('/swap/v2/build', input.config.origin);
  url.search = new URLSearchParams({
    amount: payload.amount,
    computeUnitPricePercentile: 'medium',
    inputMint: payload.inputMint,
    maxAccounts: '64',
    outputMint: payload.outputMint,
    payer: payload.taker,
    slippageBps: '50',
    taker: payload.taker,
    wrapAndUnwrapSol: 'false',
  }).toString();

  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'x-api-key': input.config.apiKey },
      signal: controller.signal,
    });
    const body = await response.text();
    const upstreamMs = performance.now() - started;

    if (
      !response.ok ||
      new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES ||
      !validUpstreamResponse(body, payload)
    ) {
      return {
        response: errorResponse(
          502,
          'swap_build_failed',
          'Stablecoin conversion could not be prepared.',
          input.traceId,
        ),
        outcome: 'error',
        upstreamMs,
      };
    }

    return {
      response: new Response(body, { status: 200, headers: JSON_HEADERS }),
      outcome: 'ok',
      upstreamMs,
    };
  } catch {
    return {
      response: errorResponse(
        502,
        'swap_build_failed',
        'Stablecoin conversion could not be prepared.',
        input.traceId,
      ),
      outcome: 'error',
      upstreamMs: performance.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parsePayload(
  value: unknown,
  allowedMints: readonly [string, string],
): SwapBuildPayload | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;

  if (
    typeof payload.amount !== 'string' ||
    !/^\d+$/u.test(payload.amount) ||
    typeof payload.inputMint !== 'string' ||
    typeof payload.outputMint !== 'string' ||
    typeof payload.taker !== 'string' ||
    !allowedMints.includes(payload.inputMint) ||
    !allowedMints.includes(payload.outputMint) ||
    payload.inputMint === payload.outputMint
  ) {
    return null;
  }

  try {
    const amount = BigInt(payload.amount);

    if (amount <= 0n || amount > MAX_U64 || base58.decode(payload.taker).length !== 32) {
      return null;
    }
  } catch {
    return null;
  }

  return payload as SwapBuildPayload;
}

function validUpstreamResponse(body: string, request: SwapBuildPayload): boolean {
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    return (
      value.inputMint === request.inputMint &&
      value.outputMint === request.outputMint &&
      value.inAmount === request.amount &&
      typeof value.outAmount === 'string' &&
      /^\d+$/u.test(value.outAmount) &&
      typeof value.otherAmountThreshold === 'string' &&
      /^\d+$/u.test(value.otherAmountThreshold) &&
      value.swapMode === 'ExactIn' &&
      value.slippageBps === 50 &&
      typeof value.swapInstruction === 'object' &&
      value.swapInstruction !== null &&
      typeof value.blockhashWithMetadata === 'object' &&
      value.blockhashWithMetadata !== null
    );
  } catch {
    return false;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
