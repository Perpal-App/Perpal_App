import type { ResolvedCluster } from './env';
import type { DispatchResult } from './rpcDispatch';
import { RedisStore } from './redisStore';
import { hashIdempotencyKey } from './requestAuth';

const PENDING_TTL_SECONDS = 120;
const RESULT_TTL_SECONDS = 6 * 60 * 60;
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

export type IdempotencyRecord =
  | { readonly state: 'pending'; readonly bodyHash: string }
  | {
      readonly state: 'done';
      readonly bodyHash: string;
      readonly responseBody: string;
      readonly provider: string;
      readonly routing: DispatchResult['routing'];
    };

export type IdempotencyStart =
  | { readonly status: 'new'; readonly storageKey: string }
  | { readonly status: 'replay'; readonly record: Extract<IdempotencyRecord, { state: 'done' }> }
  | { readonly status: 'conflict' }
  | { readonly status: 'in-flight' }
  | { readonly status: 'invalid-key' };

function parseRecord(value: string | null): IdempotencyRecord | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as IdempotencyRecord;
    return parsed.state === 'pending' || parsed.state === 'done' ? parsed : null;
  } catch {
    return null;
  }
}

export async function beginIdempotentRequest({
  actorHash,
  bodyHash,
  cluster,
  key,
  redis,
}: {
  readonly actorHash: string;
  readonly bodyHash: string;
  readonly cluster: ResolvedCluster;
  readonly key: string | null;
  readonly redis: RedisStore;
}): Promise<IdempotencyStart> {
  if (key === null || !KEY_PATTERN.test(key)) {
    return { status: 'invalid-key' };
  }

  const storageKey = await hashIdempotencyKey(cluster, actorHash, key);
  const existing = parseRecord(await redis.get(storageKey));

  if (existing !== null) {
    if (existing.bodyHash !== bodyHash) {
      return { status: 'conflict' };
    }

    return existing.state === 'done'
      ? { status: 'replay', record: existing }
      : { status: 'in-flight' };
  }

  const reserved = await redis.reserve(
    storageKey,
    JSON.stringify({ state: 'pending', bodyHash }),
    PENDING_TTL_SECONDS,
  );

  return reserved
    ? { status: 'new', storageKey }
    : { status: 'in-flight' };
}

export async function finishIdempotentRequest(
  redis: RedisStore,
  storageKey: string,
  bodyHash: string,
  responseBody: string,
  result: DispatchResult,
): Promise<void> {
  await redis.put(
    storageKey,
    JSON.stringify({
      state: 'done',
      bodyHash,
      responseBody,
      provider: result.provider.id,
      routing: result.routing,
    } satisfies IdempotencyRecord),
    RESULT_TTL_SECONDS,
  );
}
