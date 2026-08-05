import {
  AllProvidersUnavailableError,
  DEFAULT_ROUTER_OPTIONS,
  type ProviderEndpoint,
  type ProviderRouter,
} from './providerRouter';
import { isHedgeable, type MethodClass } from './rpcAllowlist';

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

export async function dispatchRpc(
  router: ProviderRouter,
  body: string,
  methodClass: MethodClass,
): Promise<DispatchResult> {
  if (methodClass === 'write') {
    const endpoints = router.availableEndpoints();

    if (endpoints.length === 0) {
      throw new AllProvidersUnavailableError();
    }

    // Only identical, already-signed sendTransaction bytes reach this branch.
    const winner = await Promise.any(
      endpoints.map((endpoint) => attempt(router, endpoint, body)),
    );

    return { ...winner, routing: 'broadcast' };
  }

  const primary = router.primary();
  const primaryAttempt = attempt(router, primary, body);

  if (!isHedgeable(methodClass)) {
    try {
      return { ...(await primaryAttempt), routing: 'single' };
    } catch (cause) {
      const secondary = router.hedgeTarget(primary.id);

      if (secondary === null) {
        throw cause;
      }

      return {
        ...(await attempt(router, secondary, body)),
        routing: 'failover',
      };
    }
  }

  const secondary = router.hedgeTarget(primary.id);

  if (secondary === null) {
    return { ...(await primaryAttempt), routing: 'single' };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let hedgeWindowElapsed = false;
  let secondaryAttempt:
    | Promise<{ response: Response; provider: ProviderEndpoint }>
    | undefined;
  const startSecondary = () => {
    secondaryAttempt ??= attempt(router, secondary, body);
    return secondaryAttempt;
  };
  const hedgeAttempt = new Promise<{
    response: Response;
    provider: ProviderEndpoint;
  }>((resolve, reject) => {
    timer = setTimeout(() => {
      hedgeWindowElapsed = true;
      void startSecondary().then(resolve, reject);
    }, DEFAULT_ROUTER_OPTIONS.hedgeAfterMs);
  });

  try {
    const result = await Promise.race([
      primaryAttempt.catch(() => startSecondary()),
      hedgeAttempt,
    ]);
    return {
      ...result,
      routing:
        result.provider.id === primary.id
          ? 'single'
          : hedgeWindowElapsed
            ? 'hedged'
            : 'failover',
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
