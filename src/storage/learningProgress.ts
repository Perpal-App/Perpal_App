import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * Experience the reader has earned, as a single running total.
 *
 * A total rather than a ledger of awards. A ledger would let the profile screen show a history
 * of where experience came from, and it would also grow without bound in a store that exists
 * for small, bounded state — when lesson history is worth keeping it belongs in SQLite with the
 * lesson records themselves, not here. The level is never stored: it is derived from this total
 * every time, so the curve can change without a migration.
 *
 * Its own MMKV id, like the bookmarks and notification stores: one owner per file, so no two
 * modules can write it with different assumptions about its shape.
 *
 * Nothing awards experience yet. The learning modules are not built, so this reads zero for
 * every reader, and the profile screen says so rather than dressing an empty counter up as
 * progress. `awardLearningXp` is the seam those modules will call.
 */
const KEY = 'progress.v1';

/**
 * Most experience a single award may carry.
 *
 * A bound on the seam rather than trust in its callers: one wrong multiplier in a lesson's
 * reward should cost a lesson's worth of experience, not silently hand out a hundred levels.
 */
const MAX_AWARD = 1_000;

/** Ceiling on the stored total, well past any plausible curriculum. Keeps the value bounded. */
const MAX_TOTAL = 1_000_000;

const listeners = new Set<() => void>();
let storage: MMKV | null = null;
/**
 * The cached total, and the reason one is needed: `useSyncExternalStore` re-renders whenever
 * `getSnapshot` returns something that is not equal to the last value, so reading through to
 * MMKV on every call would be a disk read per render. Every write replaces this once.
 */
let snapshot: number | null = null;

function getStorage(): MMKV {
  storage ??= createMMKV({
    id: 'perpal.learning.v1',
    compareBeforeSet: true,
    recoveryStrategy: 'discard-on-error',
  });
  return storage;
}

/** Total experience earned. Zero when nothing has been awarded or the store is unreadable. */
export function readLearningXp(): number {
  if (snapshot !== null) return snapshot;

  try {
    snapshot = clamp(getStorage().getNumber(KEY) ?? 0);
  } catch {
    // Unreadable storage reads as no experience. This is a progress counter; losing it is a
    // far better outcome than failing the screen that renders it.
    snapshot = 0;
  }

  return snapshot;
}

export function subscribeLearningXp(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Adds experience and wakes every subscriber.
 *
 * The seam for the learning modules: a completed lesson or quest calls this once with what it
 * is worth. Rejects anything that is not a positive whole number, so a malformed reward cannot
 * poison the total or turn it into `NaN` — which would render as a level of `NaN` and persist.
 *
 * The in-memory total is replaced before the disk write and the write is allowed to fail on its
 * own: experience granted for something the reader just finished has to show now, and progress
 * that survives the session but not a restart is a much smaller failure than a lesson that
 * appears to award nothing.
 */
export function awardLearningXp(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;

  const award = Math.min(Math.floor(amount), MAX_AWARD);
  const next = clamp(readLearningXp() + award);

  if (next === snapshot) return;

  snapshot = next;

  try {
    getStorage().set(KEY, next);
  } catch {
    // Kept in memory for this session; see above.
  }

  for (const listener of listeners) listener();
}

/** Whatever came off disk, forced into a whole number inside the supported range. */
function clamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_TOTAL);
}
