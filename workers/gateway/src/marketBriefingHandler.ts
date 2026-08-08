import {
  ConfigurationError,
  resolvePublicMarketBriefingConfig,
  type PublicMarketBriefingConfig,
  type WorkerEnv,
} from './env';
import { isOriginAllowed } from './http';
import { parsePublicMarketBriefing } from './marketBriefing';

export const MARKET_BRIEFING_PATH = '/v1/market-briefing';

const CACHE_NAME = 'perpal-market-briefing-v2';
const MAX_RESPONSE_BYTES = 512 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;
const JSON_HEADERS = {
  'cache-control': 'public, max-age=60, s-maxage=600',
  'content-type': 'application/json',
} as const;

export type MarketBriefingRouteResult = {
  readonly response: Response;
  readonly outcome: 'ok' | 'error' | 'rejected';
  readonly upstreamMs?: number;
};

export type WorkerWaitUntilContext = {
  readonly waitUntil: (promise: Promise<unknown>) => void;
};

export async function handleMarketBriefingRequest(
  request: Request,
  env: WorkerEnv,
  context: WorkerWaitUntilContext,
  traceId: string,
): Promise<MarketBriefingRouteResult> {
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
    key: `mainnet:${MARKET_BRIEFING_PATH}`,
  });

  if (!rateLimit.success) {
    return result(errorResponse(429, 'rate_limited', traceId), 'rejected');
  }

  try {
    const config = resolvePublicMarketBriefingConfig(env);
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);

    if (cached !== undefined) {
      return result(new Response(cached.body, cached), 'ok');
    }

    const started = performance.now();
    const response = await fetchBriefing(config);
    context.waitUntil(cache.put(request, response.clone()).catch(() => undefined));
    return result(response, 'ok', performance.now() - started);
  } catch (cause) {
    const misconfigured = cause instanceof ConfigurationError;
    console.error(JSON.stringify({
      traceId,
      operation: 'markets.briefing',
      outcome: 'error',
      errorName: cause instanceof Error ? cause.name : typeof cause,
      errorMessage: cause instanceof Error ? cause.message : 'unknown',
    }));
    return result(
      errorResponse(
        misconfigured ? 503 : 502,
        misconfigured ? 'gateway_misconfigured' : 'market_briefing_unavailable',
        traceId,
      ),
      'error',
    );
  }
}

async function fetchBriefing(config: PublicMarketBriefingConfig): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const nowMs = Date.now();

  try {
    const [crypto, markets, fed, events] = await Promise.all([
      fetchText('CoinDesk news', config.cryptoNewsUrl, 'application/xml', controller.signal),
      fetchText('MarketWatch news', config.marketsNewsUrl, 'application/xml', controller.signal),
      fetchText('Federal Reserve news', config.fedNewsUrl, 'text/xml', controller.signal),
      fetchJson('FXMacroData calendar', config.economicCalendarUrl, controller.signal),
    ]);
    const body = parsePublicMarketBriefing(
      crypto,
      markets,
      fed,
      events,
      nowMs,
    );
    return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(
  label: string,
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  const body = await fetchText(label, url, 'application/json', signal);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
}

async function fetchText(
  label: string,
  url: string,
  accept: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(url, { headers: { accept }, signal });

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }

  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(`${label} returned an oversized response.`);
  }
  return body;
}

function result(
  response: Response,
  outcome: MarketBriefingRouteResult['outcome'],
  upstreamMs?: number,
): MarketBriefingRouteResult {
  return { response, outcome, ...(upstreamMs === undefined ? {} : { upstreamMs }) };
}

function errorResponse(status: number, code: string, traceId: string): Response {
  return new Response(JSON.stringify({
    error: { code, message: 'Market news and events are unavailable.' },
    traceId,
  }), {
    status,
    headers: { ...JSON_HEADERS, 'cache-control': 'no-store' },
  });
}
