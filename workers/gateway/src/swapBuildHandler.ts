import { base58 } from '@scure/base';

import type { GatewayConfig } from './env';
import { errorResponse, JSON_HEADERS } from './gatewayResponses';

export const SWAP_BUILD_PATH = '/v1/swap/build';

const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_U64 = (1n << 64n) - 1n;

type SwapSymbol = 'SOL' | 'USDC' | 'USDT';
type SwapMode = 'legacy-stablecoin' | 'native-sol';

type SwapBuildPayload = {
  readonly amount: string;
  readonly inputMint: string;
  readonly mode: SwapMode;
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
  const parsed = parsePayload(input.payload, input.config);
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
  const query = {
    amount: payload.amount,
    computeUnitPricePercentile: 'medium',
    inputMint: payload.inputMint,
    maxAccounts: '64',
    outputMint: payload.outputMint,
    payer: payload.taker,
    slippageBps: '50',
    taker: payload.taker,
    wrapAndUnwrapSol: payload.mode === 'native-sol' ? 'true' : 'false',
  };
  const url = new URL('/swap/v2/build', input.config.origin);
  url.search = new URLSearchParams(query).toString();

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
      const noRoute = response.status === 400 && isNoRouteResponse(body);
      return {
        response: errorResponse(
          noRoute ? 400 : 502,
          noRoute ? 'swap_route_unavailable' : 'swap_build_failed',
          noRoute
            ? 'Jupiter has no route for this amount. Change the amount and try again.'
            : 'The token swap could not be prepared.',
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
          'The token swap could not be prepared.',
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
          ? 'The token swap timed out. Try again.'
          : 'The token swap could not be prepared.',
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
  allowedMints: Pick<
    NonNullable<GatewayConfig['jupiter']>,
    'legacyStablecoinMints' | 'swapAssetMints'
  >,
): ParsedPayload {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return rejectedPair();
  }
  const payload = value as Record<string, unknown>;
  if (typeof payload.amount !== 'string' || !/^\d+$/u.test(payload.amount)) {
    return rejectedAmount();
  }
  try {
    const amount = BigInt(payload.amount);
    if (amount <= 0n || amount > MAX_U64) return rejectedAmount();
  } catch {
    return rejectedAmount();
  }

  if (typeof payload.taker !== 'string' || !isPublicKey(payload.taker)) {
    return rejectedTaker();
  }
  const pair = swapPair(payload, allowedMints);
  if (pair === null) return rejectedPair();
  return {
    ok: true,
    payload: {
      amount: payload.amount,
      inputMint: pair.inputMint,
      mode: pair.mode,
      outputMint: pair.outputMint,
      taker: payload.taker,
    },
  };
}

function swapPair(
  payload: Readonly<Record<string, unknown>>,
  mints: Pick<
    NonNullable<GatewayConfig['jupiter']>,
    'legacyStablecoinMints' | 'swapAssetMints'
  >,
): {
  readonly inputMint: string;
  readonly mode: SwapMode;
  readonly outputMint: string;
} | null {
  const rules: readonly {
    readonly first: SwapSymbol;
    readonly firstMint: string;
    readonly mode: SwapMode;
    readonly second: SwapSymbol;
    readonly secondMint: string;
  }[] = [
    {
      first: 'USDC',
      firstMint: mints.swapAssetMints.USDC,
      mode: 'native-sol',
      second: 'SOL',
      secondMint: mints.swapAssetMints.SOL,
    },
    {
      first: 'USDC',
      firstMint: mints.legacyStablecoinMints.USDC,
      mode: 'legacy-stablecoin',
      second: 'USDT',
      secondMint: mints.legacyStablecoinMints.USDT,
    },
  ];

  if (payload.inputSymbol !== undefined || payload.outputSymbol !== undefined) {
    if (
      !isSwapSymbol(payload.inputSymbol) ||
      !isSwapSymbol(payload.outputSymbol) ||
      payload.inputSymbol === payload.outputSymbol
    ) {
      return null;
    }
    const rule = rules.find(({ first, second }) =>
      (payload.inputSymbol === first && payload.outputSymbol === second) ||
      (payload.inputSymbol === second && payload.outputSymbol === first));
    if (rule === undefined) return null;
    const inputMint = payload.inputSymbol === rule.first
      ? rule.firstMint
      : rule.secondMint;
    const outputMint = payload.outputSymbol === rule.first
      ? rule.firstMint
      : rule.secondMint;
    if (
      (payload.inputMint !== undefined && payload.inputMint !== inputMint) ||
      (payload.outputMint !== undefined && payload.outputMint !== outputMint)
    ) {
      return null;
    }
    return { inputMint, mode: rule.mode, outputMint };
  }

  if (
    typeof payload.inputMint !== 'string' ||
    typeof payload.outputMint !== 'string' ||
    payload.inputMint === payload.outputMint
  ) {
    return null;
  }
  const rule = rules.find(({ firstMint, secondMint }) =>
    (payload.inputMint === firstMint && payload.outputMint === secondMint) ||
    (payload.inputMint === secondMint && payload.outputMint === firstMint));
  return rule === undefined
    ? null
    : {
        inputMint: payload.inputMint,
        mode: rule.mode,
        outputMint: payload.outputMint,
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

function isNoRouteResponse(body: string): boolean {
  try {
    const value = JSON.parse(body) as Record<string, unknown>;
    const code = typeof value.errorCode === 'string'
      ? value.errorCode
      : typeof value.code === 'string'
        ? value.code
        : '';
    return code === 'COULD_NOT_FIND_ANY_ROUTE' ||
      code === 'ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT' ||
      code === 'NO_ROUTES_FOUND';
  } catch {
    return false;
  }
}

function isSwapSymbol(value: unknown): value is SwapSymbol {
  return value === 'SOL' || value === 'USDC' || value === 'USDT';
}

function isPublicKey(value: string): boolean {
  try {
    return base58.decode(value).length === 32;
  } catch {
    return false;
  }
}

function rejectedAmount(): ParsedPayload {
  return {
    ok: false,
    rejection: {
      code: 'swap_amount_invalid',
      message: 'Enter a valid token amount.',
    },
  };
}

function rejectedPair(): ParsedPayload {
  return {
    ok: false,
    rejection: {
      code: 'swap_pair_invalid',
      message: 'Select a supported swap pair.',
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
