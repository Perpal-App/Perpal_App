import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * Markets the reader has bookmarked, newest first.
 *
 * Held as venue references rather than as market objects: the catalog is the venue's to
 * describe and it changes under us — a stored copy of a market's name, leverage cap or icon
 * would go stale silently, and a delisted market would keep a row alive with data nothing
 * can refresh. A reference either resolves against the live catalog or it does not appear.
 *
 * Insertion order is the stored order, and reading it back does not re-sort. A bookmark list
 * is one the reader built, so it stays where they put it instead of reshuffling itself every
 * time the ranking behind it moves.
 *
 * Its own MMKV id, like the notification log: one owner per store, so no two modules can
 * write the same file with different assumptions about its shape.
 */
const KEY = 'markets.v1';

/**
 * Cap on stored bookmarks. This is a shortlist that renders in full on the home screen, not
 * an archive — past this many the section stops being a glance and becomes a second markets
 * table, which the markets tab already is.
 */
const MAX_ITEMS = 30;

/** Longest venue reference accepted. Well past anything the venue issues. */
const MAX_REF_LENGTH = 64;

const listeners = new Set<() => void>();
let storage: MMKV | null = null;
/**
 * The cached snapshot, and the reason one is needed: `useSyncExternalStore` re-renders
 * whenever `getSnapshot` returns a value that is not reference-equal to the last, so parsing
 * fresh JSON on every call would loop. Every write replaces this once.
 */
let snapshot: readonly string[] | null = null;

function getStorage(): MMKV {
  storage ??= createMMKV({
    id: 'perpal.bookmarks.v1',
    compareBeforeSet: true,
    recoveryStrategy: 'discard-on-error',
  });
  return storage;
}

export function readMarketBookmarks(): readonly string[] {
  if (snapshot !== null) return snapshot;

  try {
    const value = getStorage().getString(KEY);
    snapshot = value === undefined ? [] : parse(JSON.parse(value) as unknown);
  } catch {
    // Unreadable or malformed storage reads as no bookmarks. This is a convenience list;
    // losing it is a far better outcome than failing the screen that renders it.
    snapshot = [];
  }

  return snapshot;
}

export function subscribeMarketBookmarks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Adds or removes a bookmark and notifies every subscriber.
 *
 * The in-memory snapshot is replaced before the disk write and the write is allowed to fail
 * on its own: the toggle is a direct response to a tap, so the UI has to move now, and a
 * bookmark that survives the session but not a restart is a much smaller failure than one
 * whose star does not light up when pressed.
 */
export function toggleMarketBookmark(venueRef: string): void {
  if (venueRef.length === 0 || venueRef.length > MAX_REF_LENGTH) return;

  const current = readMarketBookmarks();
  snapshot = current.includes(venueRef)
    ? current.filter((ref) => ref !== venueRef)
    : [venueRef, ...current].slice(0, MAX_ITEMS);

  try {
    getStorage().set(KEY, JSON.stringify(snapshot));
  } catch {
    // Kept in memory for this session; see above.
  }

  for (const listener of listeners) listener();
}

/**
 * Validates what came off disk one entry at a time, keeping whatever is usable.
 *
 * Duplicates are dropped rather than tolerated because they would render as two identical
 * rows sharing a key, and the cap is applied here as well as on write so a file left behind
 * by an older, more generous version cannot flood the section.
 */
function parse(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];

  const refs: string[] = [];

  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    if (entry.length === 0 || entry.length > MAX_REF_LENGTH) continue;
    if (refs.includes(entry)) continue;

    refs.push(entry);
    if (refs.length === MAX_ITEMS) break;
  }

  return refs;
}
