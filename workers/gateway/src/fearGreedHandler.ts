import {
  ConfigurationError,
  resolveFearGreedUrl,
  type WorkerEnv,
} from './env';
import { isOriginAllowed } from './http';

export const FEAR_GREED_PATH = '/v1/sentiment/fear-greed';

const MAX_RESPONSE_BYTES = 8 * 1024;
const UPSTREAM_TIMEOUT_MS = 5_000;
const JSON_HEADERS = {
  'cache-control': 'public, max-age=300, s-maxage=900',
  'content-type': 'application/json',
} as const;

export type FearGreedRouteResult = {
  readonly response: Response;
  readonly outcome: 'ok' | 'error' | 'rejected';
  readonly upstreamMs?: number;
};

export async function handleFearGreedRequest(
  request: Request,
  env: WorkerEnv,
  traceId: string,
): Promise<FearGreedRouteResult> {
  if (!isOriginAllowed(request, [])) {
    return result(errorResponse(403, 'origin_not_allowed', traceId), 'rejected');
  }

  if (request.method !== 'GET') {
    return result(errorResponse(405, 'method_not_allowed', traceId), 'rejected');
  }

  if (env.GLOBAL_RATE_LIMITER === undefined) {
    return result(errorResponse(503, 'rate_limit_unavailable', traceId), 'error');
  }

  const rateLimit = await env.GLOBAL_RATE_LIMITER.limit({
    key: `mainnet:${FEAR_GREED_PATH}`,
  });

  if (!rateLimit.success) {
    return result(errorResponse(429, 'rate_limited', traceId), 'rejected');
  }

  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(resolveFearGreedUrl(env), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`CoinMarketCap returned HTTP ${response.status}.`);
    }

    const body = await response.text();

    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('CoinMarketCap returned an oversized response.');
    }

    JSON.parse(body);
    return result(
      new Response(body, { status: 200, headers: JSON_HEADERS }),
      'ok',
      performance.now() - started,
    );
  } catch (cause) {
    const misconfigured = cause instanceof ConfigurationError;
    return result(
      errorResponse(
        misconfigured ? 503 : 502,
        misconfigured ? 'gateway_misconfigured' : 'sentiment_unavailable',
        traceId,
      ),
      'error',
      performance.now() - started,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function result(
  response: Response,
  outcome: FearGreedRouteResult['outcome'],
  upstreamMs?: number,
): FearGreedRouteResult {
  return {
    response,
    outcome,
    ...(upstreamMs === undefined ? {} : { upstreamMs }),
  };
}

function errorResponse(status: number, code: string, traceId: string): Response {
  return new Response(
    JSON.stringify({
      error: { code, message: 'Fear and Greed data is unavailable.' },
      traceId,
    }),
    { status, headers: { ...JSON_HEADERS, 'cache-control': 'no-store' } },
  );
}
