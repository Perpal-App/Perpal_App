import {
  redactUrl,
  type GatewayConfig,
  type WorkerEnv,
} from './env';
import type { ProviderRouter } from './providerRouter';

export const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  traceId: string,
): Response {
  return jsonResponse({ error: { code, message }, traceId }, status);
}

export function logGatewayRequest(
  fields: Readonly<Record<string, string | number | boolean>>,
): void {
  console.log(JSON.stringify(fields));
}

export async function healthResponse(input: {
  readonly config: GatewayConfig;
  readonly env: WorkerEnv;
  readonly router: ProviderRouter;
  readonly traceId: string;
}): Promise<Response> {
  return jsonResponse({
    status:
      input.config.redis !== null &&
      input.env.RATE_LIMITER !== undefined &&
      input.env.GLOBAL_RATE_LIMITER !== undefined
        ? 'ok'
        : 'degraded',
    cluster: input.config.cluster,
    perpsProviders: input.config.perpsProviders,
    providers: input.router.snapshot(),
    endpoints: input.config.providers.map((provider) => redactUrl(provider.url)),
    redisConfigured: input.config.redis !== null,
    rateLimiterConfigured: input.env.RATE_LIMITER !== undefined,
    globalRateLimiterConfigured: input.env.GLOBAL_RATE_LIMITER !== undefined,
    telemetryConfigured: input.env.TELEMETRY !== undefined,
    pythApiKeyConfigured: Boolean(input.config.marketData.apiKey),
    financialNewsConfigured: [
      input.env.COINDESK_NEWS_FEED_URL,
      input.env.MARKETWATCH_NEWS_FEED_URL,
      input.env.FED_MONETARY_NEWS_FEED_URL,
      input.env.USD_ECONOMIC_CALENDAR_URL,
    ].every((value) => Boolean(value?.trim())),
    traceId: input.traceId,
  });
}
