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

type PayloadRejection = {
  readonly code: 'swap_amount_invalid' | 'swap_pair_invalid' | 'swap_taker_invalid';
  readonly message: string;
};

type ParsedPayload =
  | { readonly ok: true; readonly payload: SwapBuildPayload }
  | { readonly ok: false; readonly rejection: PayloadRejection };

export async function handleSwapBuildRequest(input: {
  readonly config: NonNullable<GatewayConfig['jupiter']>;
  readonly payload: unknown;
  readonly traceId: string;
}): Promise<{
  readonly response: Response;
  readonly outcome: 'ok' | 'error' | 'rejected';
  readonly upstreamMs?: number;
}> {
  const parsed = parsePayload(input.payload, input.config.stablecoinMints);

  if (!parsed.ok) {
    return {
      response: errorResponse(
        400,
        parsed.rejection.code,
        parsed.rejection.message,
        input.traceId,
      ),
      outcome: 'rejected',
    };
  }

  const payload = parsed.payload;

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

    if (!response.ok) {
      const noRoute = response.status === 400;
      return {
        response: errorResponse(
          noRoute ? 400 : 502,
          noRoute ? 'swap_route_unavailable' : 'swap_build_failed',
          noRoute
            ? 'Jupiter has no route for this amount. Enter a larger amount and try again.'
            : 'Stablecoin conversion could not be prepared.',
          input.traceId,
        ),
        outcome: noRoute ? 'rejected' : 'error',
        upstreamMs,
      };
    }

    if (
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
    const timedOut = controller.signal.aborted;
    return {
      response: errorResponse(
        502,
        timedOut ? 'swap_build_timeout' : 'swap_build_failed',
        timedOut
          ? 'Stablecoin conversion timed out. Try again.'
          : 'Stablecoin conversion could not be prepared.',
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
): ParsedPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return rejectedPair();
  }

  const payload = value as Record<string, unknown>;

  if (
    typeof payload.amount !== 'string' ||
    !/^\d+$/u.test(payload.amount)
  ) {
    return {
      ok: false,
      rejection: {
        code: 'swap_amount_invalid',
        message: 'Enter a valid stablecoin amount.',
      },
    };
  }

  try {
    const amount = BigInt(payload.amount);

    if (amount <= 0n || amount > MAX_U64) {
      return {
        ok: false,
        rejection: {
          code: 'swap_amount_invalid',
          message: 'Enter a valid stablecoin amount.',
        },
      };
    }
  } catch {
    return {
      ok: false,
      rejection: {
        code: 'swap_amount_invalid',
        message: 'Enter a valid stablecoin amount.',
      },
    };
  }

  if (typeof payload.taker !== 'string') {
    return rejectedTaker();
  }

  try {
    if (base58.decode(payload.taker).length !== 32) {
      return rejectedTaker();
    }
  } catch {
    return rejectedTaker();
  }

  const pair = stablecoinPair(payload, allowedMints);

  if (pair === null) {
    return rejectedPair();
  }

  return {
    ok: true,
    payload: {
      amount: payload.amount,
      inputMint: pair.inputMint,
      outputMint: pair.outputMint,
      taker: payload.taker,
    },
  };
}

function stablecoinPair(
  payload: Readonly<Record<string, unknown>>,
  [usdcMint, usdtMint]: readonly [string, string],
): { readonly inputMint: string; readonly outputMint: string } | null {
  const symbols = { USDC: usdcMint, USDT: usdtMint } as const;

  if (payload.inputSymbol !== undefined || payload.outputSymbol !== undefined) {
    if (
      !isStablecoinSymbol(payload.inputSymbol) ||
      !isStablecoinSymbol(payload.outputSymbol) ||
      payload.inputSymbol === payload.outputSymbol
    ) {
      return null;
    }

    if (
      (payload.inputMint !== undefined && payload.inputMint !== symbols[payload.inputSymbol]) ||
      (payload.outputMint !== undefined && payload.outputMint !== symbols[payload.outputSymbol])
    ) {
      return null;
    }

    return {
      inputMint: symbols[payload.inputSymbol],
      outputMint: symbols[payload.outputSymbol],
    };
  }

  if (
    typeof payload.inputMint !== 'string' ||
    typeof payload.outputMint !== 'string' ||
    ![usdcMint, usdtMint].includes(payload.inputMint) ||
    ![usdcMint, usdtMint].includes(payload.outputMint) ||
    payload.inputMint === payload.outputMint
  ) {
    return null;
  }

  return {
    inputMint: payload.inputMint,
    outputMint: payload.outputMint,
  };
}

function isStablecoinSymbol(value: unknown): value is 'USDC' | 'USDT' {
  return value === 'USDC' || value === 'USDT';
}

function rejectedPair(): ParsedPayload {
  return {
    ok: false,
    rejection: {
      code: 'swap_pair_invalid',
      message: 'Select USDC and USDT in opposite directions.',
    },
  };
}

function rejectedTaker(): ParsedPayload {
  return {
    ok: false,
    rejection: {
      code: 'swap_taker_invalid',
      message: 'The selected Solana wallet is invalid.',
    },
  };
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
