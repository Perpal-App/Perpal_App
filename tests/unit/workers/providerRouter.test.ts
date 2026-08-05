import {
  AllProvidersUnavailableError,
  ProviderRouter,
  type ProviderEndpoint,
  type RouterOptions,
} from '../../../workers/gateway/src/providerRouter';
import { classifyMethod, isHedgeable } from '../../../workers/gateway/src/rpcAllowlist';
import { validateRpcPayload } from '../../../workers/gateway/src/rpcValidation';
import {
  ConfigurationError,
  redactUrl,
  resolveConfig,
} from '../../../workers/gateway/src/env';

const ENDPOINTS: readonly ProviderEndpoint[] = [
  { id: 'helius', url: 'https://helius.example/?api-key=secret' },
  { id: 'alchemy', url: 'https://alchemy.example/v2/secret' },
];

const OPTIONS: RouterOptions = {
  failureThreshold: 2,
  openDurationMs: 1_000,
  hedgeAfterMs: 100,
  timeoutMs: 1_000,
};

function routerWithClock() {
  let now = 0;
  const router = new ProviderRouter(ENDPOINTS, OPTIONS, () => now);

  return { router, advance: (ms: number) => (now += ms) };
}

describe('ProviderRouter', () => {
  it('spreads load instead of pinning one provider', () => {
    const { router } = routerWithClock();

    const first = router.primary();
    router.beginAttempt(first.id);

    // With one request in flight on the first provider, the next goes elsewhere.
    expect(router.primary().id).not.toBe(first.id);
  });

  it('trips a provider after the failure threshold and stops routing to it', () => {
    const { router } = routerWithClock();

    for (let attempt = 0; attempt < OPTIONS.failureThreshold; attempt += 1) {
      router.beginAttempt('helius');
      router.recordFailure('helius');
    }

    expect(router.availableEndpoints().map((e) => e.id)).toEqual(['alchemy']);
  });

  it('half-opens after the cooldown rather than staying down forever', () => {
    const { router, advance } = routerWithClock();

    for (let attempt = 0; attempt < OPTIONS.failureThreshold; attempt += 1) {
      router.beginAttempt('helius');
      router.recordFailure('helius');
    }

    advance(OPTIONS.openDurationMs);

    expect(router.availableEndpoints().map((e) => e.id)).toContain('helius');
    expect(router.snapshot().find((s) => s.provider === 'helius')?.breaker).toBe(
      'half-open',
    );
  });

  it('re-opens immediately when a half-open probe fails', () => {
    const { router, advance } = routerWithClock();

    for (let attempt = 0; attempt < OPTIONS.failureThreshold; attempt += 1) {
      router.beginAttempt('helius');
      router.recordFailure('helius');
    }

    advance(OPTIONS.openDurationMs);
    router.availableEndpoints();
    router.beginAttempt('helius');
    router.recordFailure('helius');

    expect(router.availableEndpoints().map((e) => e.id)).toEqual(['alchemy']);
  });

  it('closes the breaker on a successful probe', () => {
    const { router, advance } = routerWithClock();

    for (let attempt = 0; attempt < OPTIONS.failureThreshold; attempt += 1) {
      router.beginAttempt('helius');
      router.recordFailure('helius');
    }

    advance(OPTIONS.openDurationMs);
    router.availableEndpoints();
    router.beginAttempt('helius');
    router.recordSuccess('helius', 25);

    expect(router.snapshot().find((s) => s.provider === 'helius')?.breaker).toBe(
      'closed',
    );
  });

  it('throws when every provider is tripped', () => {
    const { router } = routerWithClock();

    for (const id of ['helius', 'alchemy'] as const) {
      for (let attempt = 0; attempt < OPTIONS.failureThreshold; attempt += 1) {
        router.beginAttempt(id);
        router.recordFailure(id);
      }
    }

    expect(() => router.primary()).toThrow(AllProvidersUnavailableError);
  });

  it('offers a distinct hedge target, and none when only one is available', () => {
    const { router } = routerWithClock();

    expect(router.hedgeTarget('helius')?.id).toBe('alchemy');

    for (let attempt = 0; attempt < OPTIONS.failureThreshold; attempt += 1) {
      router.beginAttempt('alchemy');
      router.recordFailure('alchemy');
    }

    expect(router.hedgeTarget('helius')).toBeNull();
  });
});

describe('rpcAllowlist', () => {
  it('classifies reads, heavy reads, and writes', () => {
    expect(classifyMethod('getAccountInfo')).toBe('read');
    expect(classifyMethod('simulateTransaction')).toBe('heavy-read');
    expect(classifyMethod('sendTransaction')).toBe('write');
  });

  it('rejects anything not explicitly allowlisted', () => {
    expect(classifyMethod('requestAirdrop')).toBeNull();
    expect(classifyMethod('getClusterNodes')).toBeNull();
    expect(classifyMethod('__proto__')).toBeNull();
  });

  it('never hedges a write', () => {
    expect(isHedgeable('write')).toBe(false);
    expect(isHedgeable('heavy-read')).toBe(false);
    expect(isHedgeable('read')).toBe(true);
  });
});

describe('rpcValidation', () => {
  it('accepts a bounded read batch under one canonical operation', () => {
    expect(
      validateRpcPayload([
        { jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts' },
      ]),
    ).toMatchObject({ ok: true, operation: 'rpc.batch' });
    expect(
      validateRpcPayload([
        { jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts' },
        { jsonrpc: '2.0', id: 2, method: 'getSlot' },
      ]),
    ).toMatchObject({
      ok: true,
      operation: 'rpc.batch',
      methodClass: 'read',
    });
  });

  it('rejects a forbidden method anywhere in a batch', () => {
    expect(
      validateRpcPayload([
        { jsonrpc: '2.0', id: 1, method: 'getSlot' },
        { jsonrpc: '2.0', id: 2, method: 'requestAirdrop' },
      ]),
    ).toMatchObject({ ok: false, code: 'method_not_allowed' });
  });
});

describe('redactUrl', () => {
  it('strips query-string credentials', () => {
    expect(redactUrl('https://helius.example/?api-key=secret')).toBe(
      'https://helius.example',
    );
  });

  it('strips path credentials', () => {
    expect(redactUrl('https://alchemy.example/v2/secret')).toBe(
      'https://alchemy.example',
    );
  });

  it('does not throw on malformed input', () => {
    expect(redactUrl('not a url')).toBe('[unparseable-url]');
  });
});

describe('resolveConfig provider secrets', () => {
  const base = {
    SOLANA_CLUSTER: 'devnet',
    PERPS_VENUE: 'drift-devnet',
  } as const;

  it('accepts a bare API key and composes the provider URL', () => {
    const config = resolveConfig({ ...base, HELIUS_API_KEY: 'abc-123' });

    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]?.id).toBe('helius');
    expect(config.providers[0]?.url).toContain('devnet.helius-rpc.com');
    expect(config.providers[0]?.url).toContain('abc-123');
  });

  it('rejects a full RPC URL pasted in place of the key', () => {
    expect(() =>
      resolveConfig({
        ...base,
        HELIUS_API_KEY: 'https://mainnet.helius-rpc.example/?api-key=abc-123',
      }),
    ).toThrow(ConfigurationError);
  });

  it('rejects when neither provider key is present', () => {
    expect(() => resolveConfig(base)).toThrow(ConfigurationError);
  });

  it('treats Redis as unconfigured unless both url and token are present', () => {
    const config = resolveConfig({
      ...base,
      ALCHEMY_API_KEY: 'key',
      UPSTASH_REDIS_REST_URL: 'https://fixture.upstash.example',
    });

    expect(config.redis).toBeNull();
  });
});
