import { gatewayHeaders } from '../../../src/integrations/api/gatewayProtocol';

import {
  ConfigurationError,
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
  getProviderRouter,
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
import { handleTelemetryRequest } from './telemetry';
import { routePublicData } from './publicDataRouter';
import {
  handlePublicRpcRequest,
  PUBLIC_RPC_PATH,
} from './publicRpcHandler';
import {
  errorResponse,
  healthResponse,
  JSON_HEADERS,
  logGatewayRequest,
} from './gatewayResponses';
import {
  handleSwapBuildRequest,
  SWAP_BUILD_PATH,
} from './swapBuildHandler';

const MAX_RPC_BODY_BYTES = 256 * 1024;
const MAX_TELEMETRY_BODY_BYTES = 16 * 1024;
const MAX_SWAP_BODY_BYTES = 4 * 1024;

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    context: { readonly waitUntil: (promise: Promise<unknown>) => void },
  ): Promise<Response> {
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
      logGatewayRequest({
        traceId,
        route: url.pathname,
        operation,
        outcome,
        status: response.status,
        durationMs: Math.round(total),
      });
      return response;
    };

    const publicData = await routePublicData(request, env, context, traceId);

    if (publicData !== null) {
      return complete(
        publicData.response,
        publicData.outcome,
        publicData.operation,
        publicData.upstreamMs === undefined
          ? {}
          : { upstream: publicData.upstreamMs },
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
        getProviderRouter(config.providers),
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

      return complete(
        await healthResponse({
          config,
          env,
          router: getProviderRouter(config.providers),
          traceId,
        }),
        'ok',
        'health',
      );
    }

    if (!['/v1/rpc', '/v1/telemetry', SWAP_BUILD_PATH].includes(url.pathname)) {
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
        : url.pathname === SWAP_BUILD_PATH
          ? MAX_SWAP_BODY_BYTES
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
    } else if (url.pathname === SWAP_BUILD_PATH) {
      operation = 'swap.build';
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
      const result = handleTelemetryRequest({
        dataset: env.TELEMETRY,
        payload: bodyResult.payload,
        traceId,
      });
      return complete(result.response, result.outcome, operation, {
        auth: authDuration,
      });
    }

    if (url.pathname === SWAP_BUILD_PATH) {
      if (config.jupiter === null) {
        return complete(
          errorResponse(
            503,
            'swap_unavailable',
            'Stablecoin conversion is unavailable.',
            traceId,
          ),
          'error',
          operation,
          { auth: authDuration },
        );
      }
      const result = await handleSwapBuildRequest({
        actorPublicKey: auth.actorPublicKey,
        config: config.jupiter,
        payload: bodyResult.payload,
        traceId,
      });
      return complete(result.response, result.outcome, operation, {
        auth: authDuration,
        ...(result.upstreamMs === undefined
          ? {}
          : { upstream: result.upstreamMs }),
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
    const activeRouter = getProviderRouter(config.providers);

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
          cause instanceof AllProvidersUnavailableError
              ? 503
              : 502,
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
