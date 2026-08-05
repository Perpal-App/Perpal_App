import {
  ConfigurationError,
  resolveMarketDataConfig,
  type WorkerEnv,
} from './env';
import { isOriginAllowed } from './http';
import { fetchMainnetMarkets, MARKET_DATA_PATH } from './marketData';

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export type PublicMarketsRouteResult = {
  readonly response: Response;
  readonly outcome: 'ok' | 'error' | 'rejected';
  readonly upstreamMs?: number;
};

export async function handlePublicMarketsRequest(
  request: Request,
  env: WorkerEnv,
  traceId: string,
): Promise<PublicMarketsRouteResult> {
  if (!isOriginAllowed(request, [])) {
    return result(
      errorResponse(403, 'origin_not_allowed', 'Origin is not allowed.', traceId),
      'rejected',
    );
  }

  if (request.method !== 'GET') {
    return result(
      errorResponse(405, 'method_not_allowed', 'Use GET.', traceId),
      'rejected',
    );
  }

  if (env.GLOBAL_RATE_LIMITER === undefined) {
    return result(
      errorResponse(503, 'rate_limit_unavailable', 'Market data is unavailable.', traceId),
      'error',
    );
  }

  const rateLimit = await env.GLOBAL_RATE_LIMITER.limit({
    key: `mainnet:${MARKET_DATA_PATH}`,
  });

  if (!rateLimit.success) {
    return result(
      errorResponse(429, 'rate_limited', 'Too many requests.', traceId),
      'rejected',
    );
  }

  const started = performance.now();

  try {
    const marketData = await fetchMainnetMarkets(resolveMarketDataConfig(env));
    return result(jsonResponse(marketData), 'ok', performance.now() - started);
  } catch (cause) {
    const misconfigured = cause instanceof ConfigurationError;
    return result(
      errorResponse(
        misconfigured ? 503 : 502,
        misconfigured ? 'gateway_misconfigured' : 'market_data_unavailable',
        'Market data is unavailable.',
        traceId,
      ),
      'error',
      performance.now() - started,
    );
  }
}

function result(
  response: Response,
  outcome: PublicMarketsRouteResult['outcome'],
  upstreamMs?: number,
): PublicMarketsRouteResult {
  return {
    response,
    outcome,
    ...(upstreamMs === undefined ? {} : { upstreamMs }),
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  traceId: string,
): Response {
  return jsonResponse({ error: { code, message }, traceId }, status);
}
