import {
  fetchFreshPacificaPortfolio,
  fetchPacificaPortfolio,
  type PacificaAccountSnapshot,
  type PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';

export type PacificaPortfolioStoreSnapshot = {
  readonly data: PacificaPortfolioSnapshot | null;
  readonly status: 'error' | 'loading' | 'ready' | 'stale';
  readonly updatedAtMs: number;
};

const EMPTY: PacificaPortfolioStoreSnapshot = {
  data: null,
  status: 'loading',
  updatedAtMs: 0,
};
const snapshots = new Map<string, PacificaPortfolioStoreSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const generations = new Map<string, number>();

/** One account snapshot shared by Home, Portfolio, market tickets, and background settlement. */
export function readPacificaPortfolioSnapshot(
  apiOrigin: string,
  account: string,
): PacificaPortfolioStoreSnapshot {
  return snapshots.get(key(apiOrigin, account)) ?? EMPTY;
}

export function subscribePacificaPortfolioSnapshot(
  apiOrigin: string,
  account: string,
  listener: () => void,
): () => void {
  const id = key(apiOrigin, account);
  const subscribers = listeners.get(id) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(id, subscribers);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(id);
  };
}

export function publishPacificaPortfolioSnapshot(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly snapshot: PacificaPortfolioSnapshot;
}): void {
  write(key(input.apiOrigin, input.account), {
    data: input.snapshot,
    status: 'ready',
    updatedAtMs: Date.now(),
  });
}

/** Publishes a lightweight account read immediately while retaining the latest position/order arrays. */
export function publishPacificaAccountSnapshot(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly snapshot: PacificaAccountSnapshot;
}): PacificaPortfolioSnapshot {
  const id = key(input.apiOrigin, input.account);
  const previous = snapshots.get(id)?.data;
  const snapshot: PacificaPortfolioSnapshot = {
    ...input.snapshot,
    positions: previous?.positions ?? [],
    orders: previous?.orders ?? [],
  };
  write(id, { data: snapshot, status: 'ready', updatedAtMs: Date.now() });
  return snapshot;
}

/**
 * Fetches and publishes one account snapshot, with stale-request rejection.
 *
 * A forced post-deposit read advances the account generation. A cached poll already in flight may still
 * resolve, but it cannot overwrite the forced result—the exact race that kept a ticket on its old zero
 * balance after the low-level REST cache had been cleared.
 */
export async function refreshPacificaPortfolioSnapshot(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly forceNetwork?: boolean;
  readonly signal?: AbortSignal;
}): Promise<PacificaPortfolioSnapshot> {
  const id = key(input.apiOrigin, input.account);
  const generation = (generations.get(id) ?? 0) + 1;
  generations.set(id, generation);
  const previous = snapshots.get(id) ?? EMPTY;
  if (previous.data === null) write(id, { ...previous, status: 'loading' });

  try {
    const snapshot = await (input.forceNetwork === true
      ? fetchFreshPacificaPortfolio
      : fetchPacificaPortfolio)(input.apiOrigin, input.account, input.signal);
    if (input.signal?.aborted !== true && generations.get(id) === generation) {
      publishPacificaPortfolioSnapshot({
        account: input.account,
        apiOrigin: input.apiOrigin,
        snapshot,
      });
    }
    return snapshot;
  } catch (cause) {
    if (input.signal?.aborted !== true && generations.get(id) === generation) {
      write(id, {
        ...previous,
        status: previous.data === null ? 'error' : 'stale',
      });
    }
    throw cause;
  }
}

export function clearPacificaPortfolioSnapshot(apiOrigin: string, account: string): void {
  const id = key(apiOrigin, account);
  generations.set(id, (generations.get(id) ?? 0) + 1);
  snapshots.delete(id);
  emit(id);
}

function write(id: string, snapshot: PacificaPortfolioStoreSnapshot): void {
  snapshots.set(id, snapshot);
  emit(id);
}

function emit(id: string): void {
  for (const listener of listeners.get(id) ?? []) listener();
}

function key(apiOrigin: string, account: string): string {
  return `${apiOrigin}\u0000${account}`;
}
