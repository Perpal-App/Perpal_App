/**
 * Provider routing across Helius and Alchemy.
 *
 * Both providers carry live traffic; neither idles as a cold standby, because a
 * standby you never exercise is a standby you cannot trust. Routing decisions:
 *
 * - Reads go to the provider with fewer in-flight requests.
 * - A read that exceeds its latency budget is hedged: fire the other provider and
 *   take whichever answers first. Only for idempotent reads.
 * - Write selection is handled by `rpcDispatch`: the exact same already-signed
 *   transaction bytes are broadcast to every healthy provider. This router only
 *   tracks each attempt; it never rebuilds or mutates a transaction.
 * - A failing provider is tripped by a circuit breaker and recovers gradually
 *   through a half-open probe rather than being slammed the moment it returns.
 */

export type ProviderId = 'helius' | 'alchemy';

export type ProviderEndpoint = {
  readonly id: ProviderId;
  readonly url: string;
};

type BreakerState = 'closed' | 'open' | 'half-open';

type ProviderRuntime = {
  inFlight: number;
  consecutiveFailures: number;
  breaker: BreakerState;
  openedAtMs: number;
  /** Exponentially weighted mean latency, milliseconds. */
  latencyEwmaMs: number;
};

export type RouterOptions = {
  /** Consecutive failures before a provider is tripped. */
  readonly failureThreshold: number;
  /** How long a tripped provider stays open before a probe. */
  readonly openDurationMs: number;
  /** Latency budget after which a hedge is fired. */
  readonly hedgeAfterMs: number;
  /** Hard ceiling for a single attempt. */
  readonly timeoutMs: number;
};

export const DEFAULT_ROUTER_OPTIONS: RouterOptions = {
  failureThreshold: 4,
  openDurationMs: 15_000,
  hedgeAfterMs: 400,
  timeoutMs: 8_000,
};

const EWMA_ALPHA = 0.2;

export class AllProvidersUnavailableError extends Error {
  constructor() {
    super('No RPC provider is currently available.');
    this.name = 'AllProvidersUnavailableError';
  }
}

export type AttemptOutcome = {
  readonly provider: ProviderId;
  readonly durationMs: number;
  readonly hedged: boolean;
};

export type Clock = () => number;

export class ProviderRouter {
  private readonly runtime = new Map<ProviderId, ProviderRuntime>();

  constructor(
    private readonly endpoints: readonly ProviderEndpoint[],
    private readonly options: RouterOptions = DEFAULT_ROUTER_OPTIONS,
    private readonly now: Clock = () => Date.now(),
  ) {
    if (endpoints.length === 0) {
      throw new Error('ProviderRouter requires at least one endpoint.');
    }

    for (const endpoint of endpoints) {
      this.runtime.set(endpoint.id, {
        inFlight: 0,
        consecutiveFailures: 0,
        breaker: 'closed',
        openedAtMs: 0,
        latencyEwmaMs: 0,
      });
    }
  }

  /** Endpoints currently eligible, ordered by least in-flight then lower latency. */
  availableEndpoints(): readonly ProviderEndpoint[] {
    const eligible = this.endpoints.filter((endpoint) => {
      const state = this.runtimeFor(endpoint.id);

      if (state.breaker === 'closed' || state.breaker === 'half-open') {
        return true;
      }

      // An open breaker becomes half-open once the cooldown has elapsed, letting
      // exactly one probe through instead of resuming full traffic.
      if (this.now() - state.openedAtMs >= this.options.openDurationMs) {
        state.breaker = 'half-open';
        return true;
      }

      return false;
    });

    return [...eligible].sort((left, right) => {
      const a = this.runtimeFor(left.id);
      const b = this.runtimeFor(right.id);

      return a.inFlight !== b.inFlight
        ? a.inFlight - b.inFlight
        : a.latencyEwmaMs - b.latencyEwmaMs;
    });
  }

  primary(): ProviderEndpoint {
    const [first] = this.availableEndpoints();

    if (first === undefined) {
      throw new AllProvidersUnavailableError();
    }

    return first;
  }

  /** The next distinct endpoint to hedge onto, if any. */
  hedgeTarget(exclude: ProviderId): ProviderEndpoint | null {
    return this.availableEndpoints().find((e) => e.id !== exclude) ?? null;
  }

  beginAttempt(id: ProviderId): void {
    this.runtimeFor(id).inFlight += 1;
  }

  recordSuccess(id: ProviderId, durationMs: number): void {
    const state = this.runtimeFor(id);

    state.inFlight = Math.max(0, state.inFlight - 1);
    state.consecutiveFailures = 0;
    state.breaker = 'closed';
    state.latencyEwmaMs =
      state.latencyEwmaMs === 0
        ? durationMs
        : state.latencyEwmaMs * (1 - EWMA_ALPHA) + durationMs * EWMA_ALPHA;
  }

  recordFailure(id: ProviderId): void {
    const state = this.runtimeFor(id);

    state.inFlight = Math.max(0, state.inFlight - 1);
    state.consecutiveFailures += 1;

    // A failed half-open probe re-opens immediately; the provider is still sick.
    if (
      state.breaker === 'half-open' ||
      state.consecutiveFailures >= this.options.failureThreshold
    ) {
      state.breaker = 'open';
      state.openedAtMs = this.now();
    }
  }

  snapshot(): readonly {
    readonly provider: ProviderId;
    readonly breaker: BreakerState;
    readonly inFlight: number;
    readonly latencyEwmaMs: number;
  }[] {
    return this.endpoints.map((endpoint) => {
      const state = this.runtimeFor(endpoint.id);

      return {
        provider: endpoint.id,
        breaker: state.breaker,
        inFlight: state.inFlight,
        latencyEwmaMs: Math.round(state.latencyEwmaMs),
      };
    });
  }

  private runtimeFor(id: ProviderId): ProviderRuntime {
    const state = this.runtime.get(id);

    if (state === undefined) {
      throw new Error(`Unknown provider "${id}".`);
    }

    return state;
  }
}
