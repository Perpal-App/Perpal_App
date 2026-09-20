/**
 * One toast: one line.
 *
 * There used to be a `title` as well, and the pair was always the same shape — a category on the first
 * line and the actual cause on the second. "Rotation unavailable" over "A token migration preview
 * failed." The category was derivable from what the reader had just pressed, so it spent the wider,
 * bolder line restating context they already had, and pushed the one useful sentence into a quieter
 * one underneath.
 *
 * `message` is that sentence, and it now has to stand alone: write it so it names what happened
 * without a heading above it to lean on.
 */
export type AppToast = {
  readonly id: number;
  readonly message: string;
  readonly outcome: 'success' | 'error' | 'info';
};

let nextId = 0;
let snapshot: AppToast | null = null;
const listeners = new Set<() => void>();

export function readAppToast(): AppToast | null {
  return snapshot;
}

export function subscribeAppToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function showAppToast(input: Omit<AppToast, 'id'>): void {
  snapshot = { ...input, id: nextId++ };
  emit();
}

export function dismissAppToast(id?: number): void {
  if (snapshot === null || (id !== undefined && snapshot.id !== id)) return;
  snapshot = null;
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}
