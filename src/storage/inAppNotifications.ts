import { createMMKV, type MMKV } from 'react-native-mmkv';

import { showAppToast } from '@/storage/appToast';

export type InAppNotificationKind = 'trade' | 'funding' | 'withdrawal' | 'wallet';

export type InAppNotification = {
  readonly createdAtMs: number;
  readonly id: string;
  readonly kind: InAppNotificationKind;
  readonly message: string;
  readonly outcome: 'success' | 'error' | 'info';
  /**
   * When the reader acknowledged this, or null while it is still unread.
   *
   * A timestamp rather than a boolean, and stored per item rather than as a single
   * "last read at" watermark. A watermark is smaller but it cannot express reading one
   * event and leaving the one above it unread, which is exactly what a per-row action is
   * for. The value itself is not shown anywhere yet; it exists so that ordering by when
   * something was acknowledged stays possible without another migration.
   */
  readonly readAtMs: number | null;
  readonly title: string;
};

type NotificationInput = Omit<InAppNotification, 'createdAtMs' | 'id' | 'readAtMs'>;

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
  const normalized = {
    ...input,
    message: input.message.slice(0, 160),
    title: input.title.slice(0, 80),
  };
  const now = Date.now();
  const current = readInAppNotifications();
  const latest = current[0];

  if (
    latest?.title === normalized.title &&
    latest.message === normalized.message &&
    now - latest.createdAtMs < 5_000
  ) return;

  commit([{
    ...normalized,
    createdAtMs: now,
    id: `${now}-${sequence++}`,
    readAtMs: null,
  }, ...current].slice(0, MAX_ITEMS));
  showAppToast(normalized);
}

/**
 * Acknowledges one event.
 *
 * Bails when the event is already read or missing, and that bail matters: `useSyncExternalStore`
 * re-renders on any snapshot that is not reference-equal to the last one, so committing an
 * identical list would re-render every subscriber for nothing.
 */
export function markInAppNotificationRead(id: string): void {
  const current = readInAppNotifications();
  if (!current.some((item) => item.id === id && item.readAtMs === null)) return;

  const now = Date.now();
  commit(current.map((item) => (
    item.id === id && item.readAtMs === null ? { ...item, readAtMs: now } : item
  )));
}

/** Acknowledges everything unread, under one timestamp so the batch stays identifiable. */
export function markAllInAppNotificationsRead(): void {
  const current = readInAppNotifications();
  if (!current.some((item) => item.readAtMs === null)) return;

  const now = Date.now();
  commit(current.map((item) => (
    item.readAtMs === null ? { ...item, readAtMs: now } : item
  )));
}

/** How many events are still unacknowledged, which is what the bell's badge counts. */
export function countUnreadInAppNotifications(
  items: readonly InAppNotification[],
): number {
  return items.reduce((total, item) => (item.readAtMs === null ? total + 1 : total), 0);
}

/**
 * Replaces the snapshot, persists it, and wakes every subscriber.
 *
 * The in-memory snapshot is swapped before the disk write and the write may fail on its own: an
 * acknowledgement is a direct response to a tap, so the UI has to move now, and a read flag that
 * survives the session but not a restart is a far smaller failure than a button that does nothing.
 */
function commit(next: readonly InAppNotification[]): void {
  snapshot = next;

  try {
    getStorage().set(KEY, JSON.stringify(next));
  } catch {
    // Kept in memory for this session; see above.
  }

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
      // Absent on anything written before read state existed, so a missing or unusable value
      // reads as unread rather than rejecting the record. Treating legacy events as unread is
      // the safe direction: the reader can clear them in one tap, whereas defaulting them to
      // read would silently bury events they never saw.
      readAtMs: typeof item.readAtMs === 'number' && Number.isFinite(item.readAtMs)
        ? item.readAtMs
        : null,
      title: item.title,
    }];
  }).slice(0, MAX_ITEMS);
}
