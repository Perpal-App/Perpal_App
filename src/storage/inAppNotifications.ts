import { createMMKV, type MMKV } from 'react-native-mmkv';

export type InAppNotification = {
  readonly createdAtMs: number;
  readonly id: string;
  readonly kind: 'trade' | 'funding' | 'withdrawal' | 'wallet';
  readonly message: string;
  readonly outcome: 'success' | 'error' | 'info';
  readonly title: string;
};

type NotificationInput = Omit<InAppNotification, 'createdAtMs' | 'id'>;

const KEY = 'activity.v1';
const MAX_ITEMS = 40;
const listeners = new Set<() => void>();
let storage: MMKV | null = null;
let snapshot: readonly InAppNotification[] | null = null;
let sequence = 0;

function getStorage(): MMKV {
  storage ??= createMMKV({
    id: 'perpal.notifications.v1',
    compareBeforeSet: true,
    recoveryStrategy: 'discard-on-error',
  });
  return storage;
}

export function readInAppNotifications(): readonly InAppNotification[] {
  if (snapshot !== null) return snapshot;
  try {
    const value = getStorage().getString(KEY);
    snapshot = value === undefined ? [] : parse(JSON.parse(value) as unknown);
  } catch {
    snapshot = [];
  }
  return snapshot;
}

export function subscribeInAppNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishInAppNotification(input: NotificationInput): void {
  const now = Date.now();
  const current = readInAppNotifications();
  const latest = current[0];

  if (
    latest?.title === input.title &&
    latest.message === input.message &&
    now - latest.createdAtMs < 5_000
  ) return;

  snapshot = [{
    ...input,
    createdAtMs: now,
    id: `${now}-${sequence++}`,
  }, ...current].slice(0, MAX_ITEMS);
  getStorage().set(KEY, JSON.stringify(snapshot));
  for (const listener of listeners) listener();
}

function parse(value: unknown): readonly InAppNotification[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      typeof item.title !== 'string' ||
      item.title.length === 0 ||
      item.title.length > 80 ||
      typeof item.message !== 'string' ||
      item.message.length === 0 ||
      item.message.length > 160 ||
      typeof item.createdAtMs !== 'number' ||
      !Number.isFinite(item.createdAtMs) ||
      !['trade', 'funding', 'withdrawal', 'wallet'].includes(String(item.kind)) ||
      !['success', 'error', 'info'].includes(String(item.outcome))
    ) return [];
    return [{
      createdAtMs: item.createdAtMs,
      id: item.id,
      kind: item.kind as InAppNotification['kind'],
      message: item.message,
      outcome: item.outcome as InAppNotification['outcome'],
      title: item.title,
    }];
  }).slice(0, MAX_ITEMS);
}
