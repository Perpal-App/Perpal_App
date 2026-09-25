type CachedRead = {
  readonly expiresAtMs: number;
  readonly generation: number;
  readonly value: unknown;
};

type PendingRead = {
  readonly generation: number;
  readonly promise: Promise<unknown>;
};

type RateLimit = {
  readonly lastLimitedAtMs: number;
  readonly strikes: number;
  readonly untilMs: number;
};

const MAX_CACHE_ENTRIES = 96;
const RATE_LIMIT_RESET_MS = 5 * 60_000;
const DEFAULT_RATE_LIMIT_MS = 30_000;
const MAX_RATE_LIMIT_MS = 2 * 60_000;

const cache = new Map<string, CachedRead>();
const pending = new Map<string, PendingRead>();
const rateLimits = new Map<string, RateLimit>();
let generation = 0;

export async function coordinatePacificaRead<T>(input: {
  readonly allowCached: boolean;
  readonly cacheKey: string;
  readonly maxAgeMs: number;
  readonly read: () => Promise<T>;
}): Promise<T> {
  const now = Date.now();
  const cached = cache.get(input.cacheKey);
  if (
    input.allowCached &&
    cached !== undefined &&
    cached.generation === generation &&
    cached.expiresAtMs > now
  ) {
    // Access-order eviction keeps hot account/market keys through a history backfill instead of letting
    // thirty one-off cursor pages evict them merely because they were inserted earlier.
    cache.delete(input.cacheKey);
    cache.set(input.cacheKey, cached);
    return cached.value as T;
  }

  const inFlight = pending.get(input.cacheKey);
  // A post-mutation authoritative read may join work only when that work started in the same cache
  // generation. Older physical requests are allowed to finish for their original caller, but cannot
  // satisfy or overwrite a read made after the invalidation barrier.
  if (inFlight !== undefined && inFlight.generation === generation) {
    return inFlight.promise as Promise<T>;
  }

  const readGeneration = generation;
  const request: Promise<T> = input.read()
    .then((value) => {
      if (readGeneration === generation && input.maxAgeMs > 0) {
        cache.set(input.cacheKey, {
          expiresAtMs: Date.now() + input.maxAgeMs,
          generation: readGeneration,
          value,
        });
        trimCache();
      }
      return value;
    })
    .finally(() => {
      if (pending.get(input.cacheKey)?.promise === request) pending.delete(input.cacheKey);
    });
  pending.set(input.cacheKey, { generation: readGeneration, promise: request });
  return request;
}

export function clearPacificaReadCache(): void {
  generation += 1;
  cache.clear();
}

export function pacificaReadCooldownMs(origin: string): number {
  const entry = rateLimits.get(origin);
  if (entry === undefined) return 0;
  const remaining = entry.untilMs - Date.now();
  if (remaining > 0) return remaining;
  if (Date.now() - entry.lastLimitedAtMs >= RATE_LIMIT_RESET_MS) rateLimits.delete(origin);
  return 0;
}

export function recordPacificaReadRateLimit(
  origin: string,
  providerRetryAfterMs: number | null,
): number {
  const now = Date.now();
  const previous = rateLimits.get(origin);
  const strikes = previous !== undefined && now - previous.lastLimitedAtMs < RATE_LIMIT_RESET_MS
    ? previous.strikes + 1
    : 1;
  const fallback = Math.min(
    MAX_RATE_LIMIT_MS,
    DEFAULT_RATE_LIMIT_MS * (2 ** Math.min(strikes - 1, 2)),
  );
  const duration = Math.min(
    MAX_RATE_LIMIT_MS,
    Math.max(5_000, providerRetryAfterMs ?? fallback),
  );
  rateLimits.set(origin, { lastLimitedAtMs: now, strikes, untilMs: now + duration });
  return duration;
}

function trimCache(): void {
  const now = Date.now();
  for (const [key, value] of cache) {
    if (value.expiresAtMs <= now || value.generation !== generation) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}
