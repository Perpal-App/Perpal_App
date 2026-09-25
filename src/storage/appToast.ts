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

/**
 * About how many characters fit on one line of the bar.
 *
 * The bar leaves its text roughly 268pt on a 360pt screen once the host padding, the bar padding and
 * the outcome mark are taken out, and `bodyCompact` is 14pt Poppins. An estimate rather than a
 * measurement, and used as one: it decides how long a message is left on screen and at what length copy
 * is too long to show at all, neither of which needs to be exact.
 */
export const TOAST_ONE_LINE_CHARACTERS = 38;

/**
 * The most a toast can say before the bar starts cutting it off.
 *
 * Two lines. Aim for one: a toast is read in passing, and a message that fills two lines is usually one
 * that belongs in the panel that raised it. Past this the bar ellipsizes, and the tail of a sentence is
 * where the number or the instruction tends to be — so the part that is lost is the part worth reading.
 *
 * Copy that matters has to fit inside this, which is what the `__DEV__` warning below is for: an
 * overrun should be found while the sentence is being written, not on a device.
 */
export const TOAST_MESSAGE_LIMIT = TOAST_ONE_LINE_CHARACTERS * 2;

export function showAppToast(input: Omit<AppToast, 'id'>): void {
  // Collapsed here rather than at each call site: several messages are built from template literals
  // that wrap across source lines, and a newline inside the bar costs a whole line of the two it has.
  const message = input.message.replace(/\s+/gu, ' ').trim();

  if (__DEV__ && message.length > TOAST_MESSAGE_LIMIT) {
    console.warn('[Perpal toast too long]', {
      length: message.length,
      limit: TOAST_MESSAGE_LIMIT,
      message,
    });
  }

  snapshot = { ...input, message, id: nextId++ };
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
