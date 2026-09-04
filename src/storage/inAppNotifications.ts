import { createMMKV, type MMKV } from 'react-native-mmkv';

import { recordClientTelemetry } from '@/integrations/observability/clientTelemetry';
import { showAppToast } from '@/storage/appToast';
import { privateIdentifier } from '@/storage/privateIdentifier';

export type InAppNotificationKind = 'trade' | 'funding' | 'withdrawal' | 'wallet';
export type InAppNotificationStatus =
  | 'accepted'
  | 'cancelled'
  | 'confirmed'
  | 'failed'
  | 'filled'
  | 'info'
  | 'liquidated'
  | 'settled'
  | 'submitted';

export type InAppNotificationCorrelation = {
  readonly namespace:
    | 'pacifica-balance'
    | 'pacifica-order'
    | 'pacifica-trade'
    | 'solana-transaction'
    | 'umbra-request'
    | 'wallet-operation';
  /** Used transiently to derive a digest. The source value is never persisted. */
  readonly value: string;
};

export type InAppNotification = {
  readonly createdAtMs: number;
  readonly id: string;
  readonly kind: InAppNotificationKind;
  readonly message: string;
  readonly outcome: 'success' | 'error' | 'info';
  /** Digests only. Raw signatures, addresses, request IDs, and provider IDs are never stored. */
  readonly correlationKeys: readonly string[];
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
  readonly status: InAppNotificationStatus;
  readonly title: string;
  readonly version: 2;
};

export type InAppNotificationInput = Omit<
  InAppNotification,
  'correlationKeys' | 'createdAtMs' | 'id' | 'readAtMs' | 'status' | 'version'
> & {
  readonly correlations?: readonly InAppNotificationCorrelation[];
  /** Capture before starting asynchronous work; stale identity leases are rejected. */
  readonly scopeToken: InAppNotificationScopeToken | null;
  readonly status?: InAppNotificationStatus;
};

export type InAppNotificationScope = {
  readonly network: 'mainnet';
  readonly ownerAddress: string;
};

declare const inAppNotificationScopeToken: unique symbol;
export type InAppNotificationScopeToken = string & {
  readonly [inAppNotificationScopeToken]: true;
};

const LEGACY_KEY = 'activity.v1';
const LEGACY_MIGRATION_KEY = 'activity.v1.quarantined';
const KEY_PREFIX = 'activity.v2.';
const MAX_ITEMS = 40;
const listeners = new Set<() => void>();
let storage: MMKV | null = null;
let activeKey: string | null = null;
let snapshot: readonly InAppNotification[] = [];
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
  return snapshot;
}

/** Returns an opaque lease for the currently active wallet/network scope. */
export function captureInAppNotificationScope(): InAppNotificationScopeToken | null {
  return activeKey as InAppNotificationScopeToken | null;
}

/**
 * Atomically swaps the visible and persisted notification log to one owner and network.
 *
 * The legacy log had no owner identity, so assigning it to whichever user signs in first would
 * leak another account's activity. It is quarantined (removed) rather than guessed into a scope.
 */
export function setInAppNotificationScope(scope: InAppNotificationScope | null): void {
  quarantineLegacyLog();
  const nextKey = scope === null
    ? null
    : `${KEY_PREFIX}${privateIdentifier('notification-scope', `${scope.network}:${scope.ownerAddress}`)}`;
  if (nextKey === activeKey) return;

  activeKey = nextKey;
  snapshot = nextKey === null ? [] : readScopedSnapshot(nextKey);
  emitChange();
}

function readScopedSnapshot(key: string): readonly InAppNotification[] {
  try {
    const value = getStorage().getString(key);
    return value === undefined ? [] : parse(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

export function subscribeInAppNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishInAppNotification(input: InAppNotificationInput): void {
  // Capturing the active scope after an await is unsafe: the wallet may have changed. Requiring
  // the caller's pre-operation lease prevents an old request from writing or toasting in the new
  // account. A null lease is deliberately rejected because there is no owner to receive it.
  if (input.scopeToken === null || input.scopeToken !== activeKey) return;

  const correlationKeys = [...new Set((input.correlations ?? [])
    .filter((item) => item.value.length > 0)
    .map((item) => `${item.namespace}:${privateIdentifier(item.namespace, item.value)}`))];
  const normalized = {
    kind: input.kind,
    message: input.message.slice(0, 160),
    outcome: input.outcome,
    correlationKeys,
    status: input.status ?? defaultStatus(input.outcome),
    title: input.title.slice(0, 80),
  };
  const traceId = correlationKeys[0]?.slice(correlationKeys[0].indexOf(':') + 1);
  recordClientTelemetry({
    durationMs: 0,
    operation: `notification.${normalized.kind}.${normalized.outcome}.${normalized.status}`,
    outcome: normalized.outcome === 'error' ? 'error' : 'ok',
    ...(traceId === undefined ? {} : { traceId }),
  });

  const now = Date.now();
  const current = readInAppNotifications();
  const latest = current[0];
  const correlatedIndex = correlationKeys.length === 0
    ? -1
    : current.findIndex((item) => overlaps(item.correlationKeys, correlationKeys));

  if (correlatedIndex >= 0) {
    const existing = current[correlatedIndex];
    if (
      existing === undefined ||
      (existing.status !== 'failed' && statusRank(normalized.status) < statusRank(existing.status))
    ) return;
    if (
      existing.status === normalized.status &&
      existing.outcome === normalized.outcome &&
      existing.title === normalized.title &&
      existing.message === normalized.message
    ) return;
    const replacement: InAppNotification = {
      ...existing,
      ...normalized,
      correlationKeys: [...new Set([...existing.correlationKeys, ...correlationKeys])],
      createdAtMs: now,
      readAtMs: null,
      version: 2,
    };
    commit([replacement, ...current.filter((_, index) => index !== correlatedIndex)]);
    showAppToast(normalized);
    return;
  }

  if (
    latest?.title === normalized.title &&
    latest.message === normalized.message &&
    now - latest.createdAtMs < 5_000
  ) return;

  const next: InAppNotification = {
    ...normalized,
    createdAtMs: now,
    id: `${now}-${sequence++}`,
    readAtMs: null,
    version: 2 as const,
  };
  commit([next, ...current].slice(0, MAX_ITEMS));
  showAppToast(normalized);
}

export function hasInAppNotificationCorrelation(
  correlation: InAppNotificationCorrelation,
): boolean {
  return readInAppNotificationStatus(correlation) !== null;
}

export function readInAppNotificationStatus(
  correlation: InAppNotificationCorrelation,
): InAppNotificationStatus | null {
  if (activeKey === null || correlation.value.length === 0) return null;
  const key = `${correlation.namespace}:${privateIdentifier(correlation.namespace, correlation.value)}`;
  return readInAppNotifications().find((item) => item.correlationKeys.includes(key))?.status ?? null;
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
    if (activeKey !== null) getStorage().set(activeKey, JSON.stringify(next));
  } catch {
    // Kept in memory for this session; see above.
  }

  emitChange();
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
      item.version !== 2 ||
      !['trade', 'funding', 'withdrawal', 'wallet'].includes(String(item.kind)) ||
      !['success', 'error', 'info'].includes(String(item.outcome)) ||
      !validStatus(item.status) ||
      !validCorrelationKeys(item.correlationKeys)
    ) return [];
    return [{
      correlationKeys: item.correlationKeys,
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
      status: item.status,
      title: item.title,
      version: 2 as const,
    }];
  }).slice(0, MAX_ITEMS);
}

function defaultStatus(outcome: InAppNotification['outcome']): InAppNotificationStatus {
  return outcome === 'error' ? 'failed' : outcome === 'success' ? 'confirmed' : 'info';
}

function validStatus(value: unknown): value is InAppNotificationStatus {
  return [
    'accepted', 'cancelled', 'confirmed', 'failed', 'filled', 'info',
    'liquidated', 'settled', 'submitted',
  ].includes(String(value));
}

function validCorrelationKeys(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 8 && value.every((entry) => (
    typeof entry === 'string' &&
    /^(?:pacifica-(?:balance|order|trade)|solana-transaction|umbra-request|wallet-operation):[0-9a-f]{64}$/u
      .test(entry)
  ));
}

function statusRank(status: InAppNotificationStatus): number {
  switch (status) {
    case 'submitted': return 1;
    case 'accepted': return 2;
    case 'info': return 3;
    case 'confirmed': return 4;
    case 'filled': return 5;
    case 'cancelled':
    case 'failed':
    case 'liquidated':
    case 'settled': return 6;
  }
}

function overlaps(left: readonly string[], right: readonly string[]): boolean {
  return left.some((key) => right.includes(key));
}

function emitChange(): void {
  for (const listener of listeners) listener();
}

function quarantineLegacyLog(): void {
  try {
    const owner = getStorage();
    if (owner.getBoolean(LEGACY_MIGRATION_KEY) === true) return;
    owner.remove(LEGACY_KEY);
    owner.set(LEGACY_MIGRATION_KEY, true);
  } catch {
    // Retried on the next scope activation. The unscoped data is never exposed in the meantime.
  }
}
