import { gatewayHeaders } from '../../../src/integrations/api/gatewayProtocol';

import {
  ConfigurationError,
  redactUrl,
  resolveConfig,
  type WorkerEnv,
} from './env';
import {
  corsHeaders,
  isOriginAllowed,
  readJsonBody,
  serverTiming,
} from './http';
import {
  AllProvidersUnavailableError,
  DEFAULT_ROUTER_OPTIONS,
  ProviderRouter,
  type ProviderEndpoint,
} from './providerRouter';
import {
  beginIdempotentRequest,
  finishIdempotentRequest,
} from './idempotency';
import { RedisStore } from './redisStore';
import { authenticateRequest } from './requestAuth';
import { dispatchRpc } from './rpcDispatch';
import type { MethodClass } from './rpcAllowlist';
import {
  validateRpcPayload,
  type JsonRpcRequest,
} from './rpcValidation';
import { parseTelemetryEvents, writeTelemetry } from './telemetry';
import { MARKET_DATA_PATH, MARKET_STREAM_PATH } from './marketData';
import { handlePublicMarketsRequest } from './publicMarketsHandler';
import {
  handlePublicRpcRequest,
  PUBLIC_RPC_PATH,
} from './publicRpcHandler';

const JSON_HEADERS = { 'content-type': 'application/json' } as const;
const MAX_RPC_BODY_BYTES = 256 * 1024;
const MAX_TELEMETRY_BODY_BYTES = 16 * 1024;

let router: ProviderRouter | null = null;

function getRouter(providers: readonly ProviderEndpoint[]): ProviderRouter {
  router ??= new ProviderRouter(providers, DEFAULT_ROUTER_OPTIONS);
  return router;
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

function safeLog(fields: Readonly<Record<string, string | number | boolean>>) {
  console.log(JSON.stringify(fields));
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const started = performance.now();
    const traceId = crypto.randomUUID();
    const url = new URL(request.url);
    let allowedOrigins: readonly string[] = [];

    const complete = (
      response: Response,
      outcome: string,
      operation: string,
      timings: Readonly<Record<string, number>> = {},
    ) => {
      const total = performance.now() - started;
      const headers = corsHeaders(request, allowedOrigins);

      for (const [name, value] of Object.entries(headers)) {
        response.headers.set(name, value);
      }

      response.headers.set('server-timing', serverTiming({ ...timings, total }));
      response.headers.set('x-perpal-trace-id', traceId);
      safeLog({
        traceId,
        route: url.pathname,
        operation,
        outcome,
        status: response.status,
        durationMs: Math.round(total),
      });
      return response;
    };

    if ([MARKET_DATA_PATH, MARKET_STREAM_PATH].includes(url.pathname)) {
      const result = await handlePublicMarketsRequest(request, env, traceId);
      return complete(
        result.response,
        result.outcome,
        url.pathname === MARKET_STREAM_PATH ? 'markets.stream' : 'markets.read',
        {
        ...(result.upstreamMs === undefined
          ? {}
          : { upstream: result.upstreamMs }),
        },
      );
    }

    let config;

    try {
      config = resolveConfig(env);
      allowedOrigins = config.corsAllowedOrigins;
    } catch (cause) {
      const missing = cause instanceof ConfigurationError ? cause.missing : [];
      return complete(
        errorResponse(
          503,
          'gateway_misconfigured',
          `Gateway is not configured: ${missing.join(', ')}`,
          traceId,
        ),
        'error',
        'config',
      );
    }

    if (url.pathname === PUBLIC_RPC_PATH) {
      const result = await handlePublicRpcRequest(
        request,
        env,
        getRouter(config.providers),
        allowedOrigins,
        traceId,
      );
      return complete(
        result.response,
        result.outcome,
        `rpc.public.${result.operation}`,
        result.upstreamMs === undefined ? {} : { upstream: result.upstreamMs },
      );
    }

    if (!isOriginAllowed(request, allowedOrigins)) {
      return complete(
        errorResponse(403, 'origin_not_allowed', 'Origin is not allowed.', traceId),
        'rejected',
        'cors',
      );
    }

    if (request.method === 'OPTIONS') {
      return complete(new Response(null, { status: 204 }), 'ok', 'preflight');
    }

    if (url.pathname === '/health') {
      if (request.method !== 'GET') {
        return complete(
          errorResponse(405, 'method_not_allowed', 'Use GET.', traceId),
          'rejected',
          'health',
        );
      }

      const activeRouter = getRouter(config.providers);
      return complete(
        jsonResponse({
          status:
            config.redis !== null &&
            env.RATE_LIMITER !== undefined &&
            env.GLOBAL_RATE_LIMITER !== undefined
              ? 'ok'
              : 'degraded',
          cluster: config.cluster,
          perpsProviders: config.perpsProviders,
          providers: activeRouter.snapshot(),
          endpoints: config.providers.map((provider) => redactUrl(provider.url)),
          redisConfigured: config.redis !== null,
          rateLimiterConfigured: env.RATE_LIMITER !== undefined,
          globalRateLimiterConfigured: env.GLOBAL_RATE_LIMITER !== undefined,
          telemetryConfigured: env.TELEMETRY !== undefined,
          pythApiKeyConfigured: Boolean(config.marketData.apiKey),
          traceId,
        }),
        'ok',
        'health',
      );
    }

    if (!['/v1/rpc', '/v1/telemetry'].includes(url.pathname)) {
      return complete(
        errorResponse(404, 'not_found', 'Unknown route.', traceId),
        'rejected',
        'route',
      );
    }

    if (request.method !== 'POST') {
      return complete(
        errorResponse(405, 'method_not_allowed', 'Use POST.', traceId),
        'rejected',
        'http',
      );
    }

    if (
      config.redis === null ||
      env.RATE_LIMITER === undefined ||
      env.GLOBAL_RATE_LIMITER === undefined
    ) {
      return complete(
        errorResponse(
          503,
          'security_state_unavailable',
          'Gateway security state is unavailable.',
          traceId,
        ),
        'error',
        'security',
      );
    }

    const validationStarted = performance.now();
    const bodyResult = await readJsonBody(
      request,
      url.pathname === '/v1/rpc'
        ? MAX_RPC_BODY_BYTES
        : MAX_TELEMETRY_BODY_BYTES,
    );

    if (!bodyResult.ok) {
      return complete(
        errorResponse(
          bodyResult.status,
          bodyResult.code,
          'Request body is invalid.',
          traceId,
        ),
        'rejected',
        'body',
        { validation: performance.now() - validationStarted },
      );
    }

    let operation: string;
    let methodClass: MethodClass | null = null;
    let batchRequests: readonly JsonRpcRequest[] | undefined;

    if (url.pathname === '/v1/rpc') {
      const validation = validateRpcPayload(bodyResult.payload);

      if (!validation.ok) {
        return complete(
          errorResponse(
            validation.status,
            validation.code,
            validation.message,
            traceId,
          ),
          'rejected',
          validation.operation,
        );
      }

      operation = validation.operation;
      methodClass = validation.methodClass;

      if (validation.batchRequests !== null) {
        batchRequests = validation.batchRequests;
      }
    } else {
      operation = 'telemetry.write';
    }

    const redis = new RedisStore(config.redis);
    const authStarted = performance.now();
    const auth = await authenticateRequest({
      body: bodyResult.body,
      cluster: config.cluster,
      nowMs: Date.now(),
      operation,
      request,
      redis,
    });
    const authDuration = performance.now() - authStarted;

    if (!auth.ok) {
      return complete(
        errorResponse(auth.status, auth.code, 'Request authorization failed.', traceId),
        'rejected',
        operation,
        { auth: authDuration },
      );
    }

    const [rateLimit, globalRateLimit] = await Promise.all([
      env.RATE_LIMITER.limit({
        key: `${config.cluster}:${auth.actorHash}:${url.pathname}`,
      }),
      env.GLOBAL_RATE_LIMITER.limit({
        key: `${config.cluster}:${url.pathname}`,
      }),
    ]);

    if (!rateLimit.success || !globalRateLimit.success) {
      return complete(
        errorResponse(429, 'rate_limited', 'Too many requests.', traceId),
        'rejected',
        operation,
        { auth: authDuration },
      );
    }

    if (url.pathname === '/v1/telemetry') {
      const events = parseTelemetryEvents(bodyResult.payload);

      if (events === null) {
        return complete(
          errorResponse(400, 'invalid_telemetry', 'Telemetry payload is invalid.', traceId),
          'rejected',
          operation,
          { auth: authDuration },
        );
      }

      if (env.TELEMETRY === undefined) {
        return complete(
          errorResponse(503, 'telemetry_unavailable', 'Telemetry is unavailable.', traceId),
          'error',
          operation,
          { auth: authDuration },
        );
      }

      writeTelemetry(env.TELEMETRY, events);
      return complete(jsonResponse({ accepted: events.length }, 202), 'ok', operation, {
        auth: authDuration,
      });
    }

    if (methodClass === null) {
      return complete(
        errorResponse(500, 'internal_error', 'Request classification failed.', traceId),
        'error',
        operation,
      );
    }

    let idempotencyStorageKey: string | null = null;

    if (methodClass === 'write') {
      try {
        const idempotency = await beginIdempotentRequest({
          actorHash: auth.actorHash,
          bodyHash: auth.bodyHash,
          cluster: config.cluster,
          key: request.headers.get(gatewayHeaders.idempotencyKey),
          redis,
        });

        if (idempotency.status === 'invalid-key') {
          return complete(
            errorResponse(
              400,
              'idempotency_key_required',
              'A valid idempotency key is required for state-changing requests.',
              traceId,
            ),
            'rejected',
            operation,
            { auth: authDuration },
          );
        }

        if (idempotency.status === 'conflict') {
          return complete(
            errorResponse(
              409,
              'idempotency_conflict',
              'Idempotency key was already used for another request.',
              traceId,
            ),
            'rejected',
            operation,
          );
        }

        if (idempotency.status === 'in-flight') {
          return complete(
            errorResponse(409, 'request_in_flight', 'Request is already in flight.', traceId),
            'rejected',
            operation,
          );
        }

        if (idempotency.status === 'replay') {
          const response = new Response(idempotency.record.responseBody, {
              status: 200,
              headers: {
                ...JSON_HEADERS,
                'x-perpal-idempotency': 'replayed',
                'x-perpal-provider': idempotency.record.provider,
                'x-perpal-routing': idempotency.record.routing,
              },
            });
          return complete(
            response,
            'replayed',
            operation,
            { auth: authDuration },
          );
        }

        idempotencyStorageKey = idempotency.storageKey;
      } catch {
        return complete(
          errorResponse(503, 'state_unavailable', 'Request state is unavailable.', traceId),
          'error',
          operation,
        );
      }
    }

    const upstreamStarted = performance.now();
    const activeRouter = getRouter(config.providers);

    try {
      const result = await dispatchRpc(
        activeRouter,
        bodyResult.body,
        methodClass,
        batchRequests,
      );
      const responseBody = await result.response.text();

      if (idempotencyStorageKey !== null) {
        await finishIdempotentRequest(
          redis,
          idempotencyStorageKey,
          auth.bodyHash,
          responseBody,
          result,
        );
      }

      const response = new Response(responseBody, {
        status: 200,
        headers: {
          ...JSON_HEADERS,
          'x-perpal-provider': result.provider.id,
          'x-perpal-routing': result.routing,
          ...(idempotencyStorageKey !== null
            ? { 'x-perpal-idempotency': 'stored' }
            : {}),
        },
      });

      return complete(response, 'ok', operation, {
        auth: authDuration,
        upstream: performance.now() - upstreamStarted,
      });
    } catch (cause) {
      if (idempotencyStorageKey !== null) {
        try {
          await redis.delete(idempotencyStorageKey);
        } catch {
          // Pending reservation expires after two minutes; never mask the RPC error.
        }
      }

      return complete(
        errorResponse(
          cause instanceof AllProvidersUnavailableError ? 503 : 502,
          cause instanceof AllProvidersUnavailableError
            ? 'providers_unavailable'
            : 'upstream_failure',
          cause instanceof AllProvidersUnavailableError
            ? 'All RPC providers are currently unavailable.'
            : 'The RPC provider request failed.',
          traceId,
        ),
        'error',
        operation,
        {
          auth: authDuration,
          upstream: performance.now() - upstreamStarted,
        },
      );
    }
  },
};
