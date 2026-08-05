import type { WorkerEnv } from './env';
import { isOriginAllowed, readJsonBody } from './http';
import type { ProviderRouter } from './providerRouter';
import { dispatchRpc } from './rpcDispatch';
import { validatePublicRpcPayload } from './rpcValidation';

export const PUBLIC_RPC_PATH = '/v1/rpc/public';

const MAX_PUBLIC_RPC_BODY_BYTES = 64 * 1024;
const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json',
} as const;

export type PublicRpcRouteResult = {
  readonly response: Response;
  readonly outcome: 'ok' | 'error' | 'rejected';
  readonly operation: string;
  readonly upstreamMs?: number;
};

export async function handlePublicRpcRequest(
  request: Request,
  env: WorkerEnv,
  router: ProviderRouter,
  allowedOrigins: readonly string[],
  traceId: string,
): Promise<PublicRpcRouteResult> {
  if (!isOriginAllowed(request, allowedOrigins)) {
    return result(error(403, 'origin_not_allowed', traceId), 'rejected', 'cors');
  }

  if (request.method === 'OPTIONS') {
    return result(new Response(null, { status: 204 }), 'ok', 'preflight');
  }

  if (request.method !== 'POST') {
    return result(error(405, 'method_not_allowed', traceId), 'rejected', 'http');
  }

  if (env.RATE_LIMITER === undefined || env.GLOBAL_RATE_LIMITER === undefined) {
    return result(error(503, 'rate_limit_unavailable', traceId), 'error', 'security');
  }

  const body = await readJsonBody(request, MAX_PUBLIC_RPC_BODY_BYTES);

  if (!body.ok) {
    return result(error(body.status, body.code, traceId), 'rejected', 'body');
  }

  const validation = validatePublicRpcPayload(body.payload);

  if (!validation.ok) {
    return result(
      error(validation.status, validation.code, traceId),
      'rejected',
      validation.operation,
    );
  }

  const [clientLimit, globalLimit] = await Promise.all([
    env.RATE_LIMITER.limit({ key: await clientKey(request) }),
    env.GLOBAL_RATE_LIMITER.limit({ key: `mainnet:${PUBLIC_RPC_PATH}` }),
  ]);

  if (!clientLimit.success || !globalLimit.success) {
    return result(error(429, 'rate_limited', traceId), 'rejected', validation.operation);
  }

  const started = performance.now();

  try {
    const dispatched = await dispatchRpc(
      router,
      body.body,
      validation.methodClass,
      validation.batchRequests ?? undefined,
    );
    const response = new Response(await dispatched.response.text(), {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'x-perpal-provider': dispatched.provider.id,
        'x-perpal-routing': dispatched.routing,
      },
    });
    return result(response, 'ok', validation.operation, performance.now() - started);
  } catch {
    return result(
      error(503, 'providers_unavailable', traceId),
      'error',
      validation.operation,
      performance.now() - started,
    );
  }
}

function result(
  response: Response,
  outcome: PublicRpcRouteResult['outcome'],
  operation: string,
  upstreamMs?: number,
): PublicRpcRouteResult {
  return {
    response,
    outcome,
    operation,
    ...(upstreamMs === undefined ? {} : { upstreamMs }),
  };
}

function error(status: number, code: string, traceId: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message: 'Public RPC request failed.' }, traceId }),
    { status, headers: JSON_HEADERS },
  );
}

async function clientKey(request: Request): Promise<string> {
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(address),
  );
  return `mainnet:${PUBLIC_RPC_PATH}:${Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}
