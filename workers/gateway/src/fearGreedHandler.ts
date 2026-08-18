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

    if (!response.ok) throw new Error(`Sentiment provider returned HTTP ${response.status}.`);

    const body = await response.text();

    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('Sentiment provider returned an oversized response.');
    }

    const normalized = normalizeFearGreed(JSON.parse(body) as unknown);
    return result(
      new Response(JSON.stringify(normalized), { status: 200, headers: JSON_HEADERS }),
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

function normalizeFearGreed(value: unknown): {
  readonly data: {
    readonly update_time: string;
    readonly value: number;
    readonly value_classification: string;
  };
  readonly source: 'Alternative.me';
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Sentiment provider returned an invalid response.');
  }
  const root = value as Record<string, unknown>;
  const entry = Array.isArray(root.data) ? root.data[0] : null;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error('Sentiment provider returned an invalid response.');
  }
  const record = entry as Record<string, unknown>;
  const score = typeof record.value === 'string' ? Number(record.value) : NaN;
  const timestamp = typeof record.timestamp === 'string' ? Number(record.timestamp) : NaN;
  if (
    !Number.isInteger(score) || score < 0 || score > 100 ||
    typeof record.value_classification !== 'string' ||
    record.value_classification.length === 0 || record.value_classification.length > 32 ||
    !Number.isSafeInteger(timestamp) || timestamp <= 0
  ) {
    throw new Error('Sentiment provider returned an invalid response.');
  }
  return {
    data: {
      update_time: new Date(timestamp * 1_000).toISOString(),
      value: score,
      value_classification: record.value_classification,
    },
    source: 'Alternative.me',
  };
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
