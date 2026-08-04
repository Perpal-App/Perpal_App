import { ConfigurationError, redactUrl, resolveConfig, type WorkerEnv } from './env';
import {
  AllProvidersUnavailableError,
  DEFAULT_ROUTER_OPTIONS,
  ProviderRouter,
  type ProviderEndpoint,
} from './providerRouter';
import { classifyMethod, isHedgeable } from './rpcAllowlist';

/**
 * PerPal RPC gateway.
 *
 * Exists so provider credentials never ship inside the mobile binary. It is a
 * narrow, allowlisted JSON-RPC forwarder — not a general proxy — and it holds no
 * keys, no funds, and no user identity.
 *
 * Deployed once per target (`perpal-gateway-devnet`, `perpal-gateway-mainnet`) so
 * a devnet request can never reach mainnet credentials.
 *
 * Privacy invariant: this Worker must never see the main wallet and the trading
 * wallet in the same request or log line. It therefore logs no addresses at all.
 */

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/** Router state is per-isolate, which is the right lifetime for breaker state. */
let router: ProviderRouter | null = null;

function getRouter(providers: readonly ProviderEndpoint[]): ProviderRouter {
  router ??= new ProviderRouter(providers, DEFAULT_ROUTER_OPTIONS);

  return router;
}

type JsonRpcRequest = {
  jsonrpc: string;
  id: string | number | null;
  method: string;
  params?: unknown;
};

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return candidate.jsonrpc === '2.0' && typeof candidate.method === 'string';
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  traceId: string,
): Response {
  return new Response(JSON.stringify({ error: { code, message }, traceId }), {
    status,
    headers: JSON_HEADERS,
  });
}

async function forward(
  endpoint: ProviderEndpoint,
  body: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(endpoint.url, {
      method: 'POST',
      headers: JSON_HEADERS,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends to the primary and, for hedgeable reads only, races a second provider
 * once the latency budget is exceeded. The hedge is additive: whichever answers
 * first wins and the loser is abandoned.
 */
async function dispatch(
  activeRouter: ProviderRouter,
  body: string,
  hedge: boolean,
): Promise<{ response: Response; provider: ProviderEndpoint; hedged: boolean }> {
  const primary = activeRouter.primary();
  const started = Date.now();

  activeRouter.beginAttempt(primary.id);

  const primaryAttempt = forward(primary, body, DEFAULT_ROUTER_OPTIONS.timeoutMs)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Provider responded ${response.status}`);
      }

      activeRouter.recordSuccess(primary.id, Date.now() - started);
      return { response, provider: primary, hedged: false };
    })
    .catch((cause: unknown) => {
      activeRouter.recordFailure(primary.id);
      throw cause;
    });

  if (!hedge) {
    return primaryAttempt;
  }

  const secondary = activeRouter.hedgeTarget(primary.id);

  if (secondary === null) {
    return primaryAttempt;
  }

  const hedged = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error('hedge-window-elapsed')),
      DEFAULT_ROUTER_OPTIONS.hedgeAfterMs,
    );
  }).catch(async () => {
    const hedgeStarted = Date.now();

    activeRouter.beginAttempt(secondary.id);

    try {
      const response = await forward(
        secondary,
        body,
        DEFAULT_ROUTER_OPTIONS.timeoutMs,
      );

      if (!response.ok) {
        throw new Error(`Provider responded ${response.status}`);
      }

      activeRouter.recordSuccess(secondary.id, Date.now() - hedgeStarted);
      return { response, provider: secondary, hedged: true };
    } catch (cause) {
      activeRouter.recordFailure(secondary.id);
      throw cause;
    }
  });

  return Promise.race([primaryAttempt, hedged]);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const traceId = crypto.randomUUID();
    const url = new URL(request.url);

    let config;

    try {
      config = resolveConfig(env);
    } catch (cause) {
      const missing = cause instanceof ConfigurationError ? cause.missing : [];

      return errorResponse(
        503,
        'gateway_misconfigured',
        `Gateway is not configured: ${missing.join(', ')}`,
        traceId,
      );
    }

    if (url.pathname === '/health') {
      const activeRouter = getRouter(config.providers);

      return new Response(
        JSON.stringify({
          status: 'ok',
          cluster: config.cluster,
          venue: config.venue,
          providers: activeRouter.snapshot(),
          // Redacted so a health probe can never leak a provider key.
          endpoints: config.providers.map((p) => redactUrl(p.url)),
          redisConfigured: config.redis !== null,
          traceId,
        }),
        { headers: JSON_HEADERS },
      );
    }

    if (url.pathname !== '/v1/rpc') {
      return errorResponse(404, 'not_found', 'Unknown route.', traceId);
    }

    if (request.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', 'Use POST.', traceId);
    }

    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return errorResponse(400, 'invalid_json', 'Body must be JSON.', traceId);
    }

    // Batches are rejected: a batch can mix reads and writes, which would defeat
    // per-method classification and routing.
    if (Array.isArray(payload)) {
      return errorResponse(
        400,
        'batch_unsupported',
        'Send one JSON-RPC request per call.',
        traceId,
      );
    }

    if (!isJsonRpcRequest(payload)) {
      return errorResponse(
        400,
        'invalid_request',
        'Expected a JSON-RPC 2.0 request.',
        traceId,
      );
    }

    const methodClass = classifyMethod(payload.method);

    if (methodClass === null) {
      return errorResponse(
        403,
        'method_not_allowed',
        `Method "${payload.method}" is not on the gateway allowlist.`,
        traceId,
      );
    }

    const activeRouter = getRouter(config.providers);

    try {
      const { response, provider, hedged } = await dispatch(
        activeRouter,
        JSON.stringify(payload),
        isHedgeable(methodClass),
      );

      const body = await response.text();

      return new Response(body, {
        status: 200,
        headers: {
          ...JSON_HEADERS,
          'x-perpal-trace-id': traceId,
          'x-perpal-provider': provider.id,
          'x-perpal-hedged': hedged ? '1' : '0',
        },
      });
    } catch (cause) {
      if (cause instanceof AllProvidersUnavailableError) {
        return errorResponse(
          503,
          'providers_unavailable',
          'All RPC providers are currently unavailable.',
          traceId,
        );
      }

      // Deliberately no provider URL, no request params, no addresses.
      return errorResponse(
        502,
        'upstream_failure',
        'The RPC provider request failed.',
        traceId,
      );
    }
  },
};
