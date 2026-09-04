import { base58 } from '@scure/base';

import { ConfigurationError, resolveConfig, type WorkerEnv } from './env';
import { errorResponse, JSON_HEADERS } from './gatewayResponses';
import { isOriginAllowed } from './http';

export const TOKEN_PRICES_PATH = '/v1/token-prices';

const MAX_IDS = 50;
const MAX_RESPONSE_BYTES = 128 * 1024;
const UPSTREAM_ATTEMPTS = 2;
const UPSTREAM_RETRY_DELAY_MS = 200;
const UPSTREAM_TIMEOUT_MS = 3_000;

class TokenPriceUpstreamError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'TokenPriceUpstreamError';
  }
}

export async function handleTokenPricesRequest(
  request: Request,
  env: WorkerEnv,
  traceId: string,
) {
  if (!isOriginAllowed(request, [])) {
    return result(errorResponse(403, 'origin_not_allowed', 'Origin is not allowed.', traceId), 'rejected');
  }
  if (request.method !== 'GET') {
    return result(errorResponse(405, 'method_not_allowed', 'Use GET.', traceId), 'rejected');
  }
  if (env.GLOBAL_RATE_LIMITER === undefined) {
    return result(errorResponse(503, 'rate_limit_unavailable', 'Token prices are unavailable.', traceId), 'error');
  }

  const ids = parseIds(new URL(request.url).searchParams.get('ids'));
  if (ids === null) {
    return result(errorResponse(400, 'token_ids_invalid', 'Token mint list is invalid.', traceId), 'rejected');
  }

  let rateLimit: { readonly success: boolean };
  try {
    rateLimit = await env.GLOBAL_RATE_LIMITER.limit({ key: `mainnet:${TOKEN_PRICES_PATH}` });
  } catch {
    return result(
      errorResponse(503, 'rate_limit_unavailable', 'Token prices are unavailable.', traceId),
      'error',
    );
  }
  if (!rateLimit.success) {
    return result(errorResponse(429, 'rate_limited', 'Too many requests.', traceId), 'rejected');
  }

  const started = performance.now();

  try {
    const config = resolveConfig(env).jupiter;
    if (config === null) throw new ConfigurationError(['JUPITER_API_KEY']);

    const url = new URL('/price/v3', config.origin);
    url.searchParams.set('ids', ids.join(','));
    const prices = await requestJupiterPrices(url, config.apiKey, ids);
    return result(
      new Response(JSON.stringify({
        prices,
        source: 'Jupiter Price API V3',
        timestampMs: Date.now(),
      }), {
        status: 200,
        headers: { ...JSON_HEADERS, 'cache-control': 'no-store' },
      }),
      'ok',
      performance.now() - started,
    );
  } catch (cause) {
    const misconfigured = cause instanceof ConfigurationError;
    const code = misconfigured
      ? 'gateway_misconfigured'
      : cause instanceof TokenPriceUpstreamError
        ? cause.code
        : 'token_prices_unavailable';
    return result(
      errorResponse(
        misconfigured ? 503 : 502,
        code,
        'Token prices are unavailable.',
        traceId,
      ),
      'error',
      performance.now() - started,
    );
  }
}

async function requestJupiterPrices(
  url: URL,
  apiKey: string,
  ids: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  let failure: unknown;

  for (let attempt = 1; attempt <= UPSTREAM_ATTEMPTS; attempt += 1) {
    try {
      return await requestJupiterPricesOnce(url, apiKey, ids);
    } catch (cause) {
      failure = cause;
      if (
        attempt === UPSTREAM_ATTEMPTS ||
        (cause instanceof TokenPriceUpstreamError && !cause.retryable)
      ) {
        throw cause;
      }
      await new Promise((resolve) => setTimeout(resolve, UPSTREAM_RETRY_DELAY_MS));
    }
  }

  throw failure;
}

async function requestJupiterPricesOnce(
  url: URL,
  apiKey: string,
  ids: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      signal: controller.signal,
    });
    const body = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new TokenPriceUpstreamError('token_prices_upstream_auth_failed', false);
    }
    if (!response.ok) {
      throw new TokenPriceUpstreamError('token_prices_upstream_rejected', true);
    }
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new TokenPriceUpstreamError('token_prices_response_too_large', false);
    }

    try {
      return parsePrices(JSON.parse(body), ids);
    } catch {
      throw new TokenPriceUpstreamError('token_prices_response_invalid', true);
    }
  } catch (cause) {
    if (cause instanceof TokenPriceUpstreamError) throw cause;
    throw new TokenPriceUpstreamError(
      controller.signal.aborted
        ? 'token_prices_upstream_timeout'
        : 'token_prices_upstream_unreachable',
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseIds(value: string | null): readonly string[] | null {
  const ids = value?.split(',') ?? [];
  if (ids.length === 0 || ids.length > MAX_IDS || new Set(ids).size !== ids.length) return null;

  try {
    return ids.every((id) => base58.decode(id).length === 32) ? ids : null;
  } catch {
    return null;
  }
}

function parsePrices(value: unknown, ids: readonly string[]) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Jupiter returned invalid prices.');
  }

  const input = value as Record<string, unknown>;
  return Object.fromEntries(ids.flatMap((id) => {
    const entry = input[id];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const price = (entry as Record<string, unknown>).usdPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return [];
    const decimal = price.toFixed(18).replace(/\.?0+$/u, '');
    return /^\d+(?:\.\d+)?$/u.test(decimal) && decimal !== '0' ? [[id, decimal]] : [];
  }));
}

function result(
  response: Response,
  outcome: 'ok' | 'error' | 'rejected',
  upstreamMs?: number,
) {
  return { response, outcome, ...(upstreamMs === undefined ? {} : { upstreamMs }) };
}
