import {
  mergePacificaActivity,
  type PacificaActivity,
} from '@/integrations/perps/pacifica/pacificaActivity';

export type PacificaActivitySnapshot = {
  readonly data: PacificaActivity | null;
  readonly status: 'error' | 'loading' | 'ready' | 'stale';
  readonly updatedAtMs: number;
};

const EMPTY_SNAPSHOT: PacificaActivitySnapshot = {
  data: null,
  status: 'loading',
  updatedAtMs: 0,
};

const snapshots = new Map<string, PacificaActivitySnapshot>();
const listeners = new Map<string, Set<() => void>>();

export function readPacificaActivitySnapshot(
  apiOrigin: string,
  account: string,
): PacificaActivitySnapshot {
  return snapshots.get(snapshotKey(apiOrigin, account)) ?? EMPTY_SNAPSHOT;
}

export function subscribePacificaActivitySnapshot(
  apiOrigin: string,
  account: string,
  listener: () => void,
): () => void {
  const key = snapshotKey(apiOrigin, account);
  const subscribers = listeners.get(key) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(key, subscribers);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(key);
  };
}

export function publishPacificaActivitySnapshot(input: {
  readonly account: string;
  readonly activity: PacificaActivity;
  readonly apiOrigin: string;
}): void {
  const key = snapshotKey(input.apiOrigin, input.account);
  const previous = snapshots.get(key)?.data;
  const data = previous === null || previous === undefined
    ? input.activity
    : mergePacificaActivity(previous, input.activity);
  write(key, {
    data,
    status: data.incomplete ? 'stale' : 'ready',
    updatedAtMs: Date.now(),
  });
}

export function markPacificaActivityUnavailable(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly rateLimited: boolean;
}): void {
  const key = snapshotKey(input.apiOrigin, input.account);
  const previous = snapshots.get(key) ?? EMPTY_SNAPSHOT;
  write(key, {
    ...previous,
    status: previous.data !== null
      ? 'stale'
      : input.rateLimited ? 'loading' : 'error',
  });
}

export function clearPacificaActivitySnapshot(
  apiOrigin: string,
  account: string,
): void {
  const key = snapshotKey(apiOrigin, account);
  if (!snapshots.delete(key)) return;
  emit(key);
}

function write(key: string, snapshot: PacificaActivitySnapshot): void {
  snapshots.set(key, snapshot);
  emit(key);
}

function emit(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

function snapshotKey(apiOrigin: string, account: string): string {
  return `${apiOrigin}\u0000${account}`;
}
