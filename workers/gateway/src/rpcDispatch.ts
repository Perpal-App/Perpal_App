import {
  AllProvidersUnavailableError,
  DEFAULT_ROUTER_OPTIONS,
  type ProviderEndpoint,
  type ProviderRouter,
} from './providerRouter';
import { isHedgeable, type MethodClass } from './rpcAllowlist';
import type { JsonRpcRequest } from './rpcValidation';

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

export type DispatchResult = {
  readonly response: Response;
  readonly provider: ProviderEndpoint;
  readonly routing: 'broadcast' | 'failover' | 'hedged' | 'single';
};

async function forward(
  endpoint: ProviderEndpoint,
  body: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    DEFAULT_ROUTER_OPTIONS.timeoutMs,
  );

  try {
    return await fetch(endpoint.url, {
      method: 'POST',
      headers: JSON_HEADERS,
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function attempt(
  router: ProviderRouter,
  endpoint: ProviderEndpoint,
  body: string,
): Promise<{ response: Response; provider: ProviderEndpoint }> {
  const started = performance.now();
  router.beginAttempt(endpoint.id);

  try {
    const response = await forward(endpoint, body);

    if (!response.ok) {
      throw new Error(`Provider responded ${response.status}.`);
    }

    router.recordSuccess(endpoint.id, performance.now() - started);
    return { response, provider: endpoint };
  } catch (cause) {
    router.recordFailure(endpoint.id);
    throw cause;
  }
}

function idKey(id: JsonRpcRequest['id']): string {
  return `${typeof id}:${String(id)}`;
}

function isResponseFor(value: unknown, request: JsonRpcRequest): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const id = (value as Record<string, unknown>).id;
  return (
    (id === null || typeof id === 'string' || typeof id === 'number') &&
    idKey(id) === idKey(request.id)
  );
}

async function isAcceptedWriteResponse(
  response: Response,
  request: JsonRpcRequest,
): Promise<boolean> {
  const value = (await response.clone().json().catch(() => null)) as unknown;
  if (!isResponseFor(value, request) || typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.result === 'string' && record.error === undefined;
}

async function orderedBatchResponse(
  response: Response,
  requests: readonly JsonRpcRequest[],
): Promise<readonly unknown[] | null> {
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!Array.isArray(payload) || payload.length !== requests.length) {
    return null;
  }

  const byId = new Map<string, unknown>();

  for (const item of payload) {
    if (
      typeof item !== 'object' ||
      item === null ||
      Array.isArray(item)
    ) {
      return null;
    }

    const id = (item as Record<string, unknown>).id;

    if (id !== null && typeof id !== 'string' && typeof id !== 'number') {
      return null;
    }

    const key = idKey(id);

    if (byId.has(key)) {
      return null;
    }

    byId.set(key, item);
  }

  const ordered = requests.map((request) => byId.get(idKey(request.id)));
  return ordered.includes(undefined) ? null : ordered;
}

async function attemptBatch(
  router: ProviderRouter,
  endpoint: ProviderEndpoint,
  body: string,
  requests: readonly JsonRpcRequest[],
): Promise<{ response: Response; provider: ProviderEndpoint }> {
  const started = performance.now();
  router.beginAttempt(endpoint.id);

  try {
    const batchResponse = await forward(endpoint, body);
    let payload = await orderedBatchResponse(batchResponse, requests);

    if (payload === null) {
      payload = await Promise.all(
        requests.map(async (request) => {
          const response = await forward(endpoint, JSON.stringify(request));
          const value = response.ok
            ? ((await response.json().catch(() => null)) as unknown)
            : null;

          if (!isResponseFor(value, request)) {
            throw new Error('Provider returned an invalid JSON-RPC response.');
          }

          return value;
        }),
      );
    }

    router.recordSuccess(endpoint.id, performance.now() - started);
    return {
      provider: endpoint,
      response: new Response(JSON.stringify(payload), { headers: JSON_HEADERS }),
    };
  } catch (cause) {
    router.recordFailure(endpoint.id);
    throw cause;
  }
}

export async function dispatchRpc(
  router: ProviderRouter,
  body: string,
  methodClass: MethodClass,
  batchRequests?: readonly JsonRpcRequest[],
): Promise<DispatchResult> {
  if (methodClass === 'write') {
    const endpoints = router.availableEndpoints();

    if (endpoints.length === 0) {
      throw new AllProvidersUnavailableError();
    }

    // Only identical, already-signed sendTransaction bytes reach this branch. Start every healthy
    // provider together, reject JSON-RPC error responses as winners, and return as soon as one provider
    // accepts the signature. Waiting for the slowest provider added up to the full upstream timeout after
    // a fast provider had already accepted the transaction; that did not improve landing, it only delayed
    // confirmation polling. The accepted provider has its own bounded retry budget.
    const responses: { response: Response; provider: ProviderEndpoint }[] = [];
    const attempts = endpoints.map(async (endpoint) => {
      const result = await attempt(router, endpoint, body);
      responses.push(result);
      if (await isAcceptedWriteResponse(result.response, JSON.parse(body) as JsonRpcRequest)) {
        return result;
      }
      throw new Error('Provider returned a JSON-RPC write error.');
    });

    try {
      return { ...(await Promise.any(attempts)), routing: 'broadcast' };
    } catch {
      // Every provider either failed transport or returned an RPC error. Preserve the first RPC response
      // when there is one so the client receives its typed preflight diagnostic; otherwise all providers
      // were genuinely unreachable.
      const rejected = responses[0];
      if (rejected !== undefined) return { ...rejected, routing: 'broadcast' };
      throw new AllProvidersUnavailableError();
    }
  }

  const attemptRequest = (endpoint: ProviderEndpoint) =>
    batchRequests === undefined
      ? attempt(router, endpoint, body)
      : attemptBatch(router, endpoint, body, batchRequests);

  if (methodClass === 'helius-read') {
    const helius = router.endpoint('helius');
    if (helius === null) throw new AllProvidersUnavailableError();
    return { ...(await attemptRequest(helius)), routing: 'single' };
  }

  const primary = router.primary();
  const primaryAttempt = attemptRequest(primary);

  if (!isHedgeable(methodClass)) {
    try {
      return { ...(await primaryAttempt), routing: 'single' };
    } catch (cause) {
      const secondary = router.hedgeTarget(primary.id);

      if (secondary === null) {
        throw cause;
      }

      return {
        ...(await attemptRequest(secondary)),
        routing: 'failover',
      };
    }
  }

  const secondary = router.hedgeTarget(primary.id);

  if (secondary === null) {
    return { ...(await primaryAttempt), routing: 'single' };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let secondaryAttempt:
    | Promise<{ response: Response; provider: ProviderEndpoint }>
    | undefined;
  const startSecondary = () => {
    secondaryAttempt ??= attemptRequest(secondary);
    return secondaryAttempt;
  };
  const primaryCandidate = primaryAttempt
    .then((result) => ({ result, routing: 'single' as const }))
    .catch(async () => ({ result: await startSecondary(), routing: 'failover' as const }));
  const hedgeCandidate = new Promise<{
    readonly result: { response: Response; provider: ProviderEndpoint };
    readonly routing: 'hedged';
  }>((resolve, reject) => {
    timer = setTimeout(() => {
      void startSecondary().then(
        (result) => resolve({ result, routing: 'hedged' }),
        reject,
      );
    }, DEFAULT_ROUTER_OPTIONS.hedgeAfterMs);
  });

  try {
    // First success, not first settlement. A quick secondary failure must not reject a primary request
    // that is still healthy and about to return.
    const winner = await Promise.any([primaryCandidate, hedgeCandidate]);
    return { ...winner.result, routing: winner.routing };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
