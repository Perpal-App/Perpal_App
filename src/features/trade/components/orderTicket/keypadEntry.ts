/**
 * What the ticket's keypad writes, as text: a pure, exact editor for a decimal amount.
 *
 * Strings throughout and no number ever built. An amount typed here goes to a signed order, and
 * `parseFloat` on the way through is how `0.1 + 0.2` ends up in a transaction. The entry is a plain
 * decimal the money module parses exactly, one key at a time.
 */

export type KeypadKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '.'
  | 'delete';

/** The layout, row by row: a phone's, with the point bottom-left and delete bottom-right. */
export const KEYPAD_ROWS: readonly (readonly KeypadKey[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'delete'],
];

/**
 * Nine whole digits: a billion dollars less a cent, far past anything this ticket should size, and
 * short enough that the figure stays legible at the size the collateral card sets it.
 */
const MAX_WHOLE_DIGITS = 9;

/**
 * The entry after one key.
 *
 * Returns the same string when the key cannot apply — a second point, a digit past `maxDecimals`, a
 * leading zero — so a caller can tell a refused key from an accepted one by identity and say so.
 *
 * Every result is a prefix of a valid decimal: digits, then optionally a point and at most
 * `maxDecimals` more digits. A trailing point is allowed while typing; `entryAmount` drops it.
 */
export function applyKeypadKey(entry: string, key: KeypadKey, maxDecimals: number): string {
  if (key === 'delete') return entry.slice(0, -1);

  const point = entry.indexOf('.');
  if (key === '.') {
    if (maxDecimals <= 0 || point !== -1) return entry;
    return entry.length === 0 ? '0.' : `${entry}.`;
  }

  if (point !== -1) {
    return entry.length - point - 1 >= maxDecimals ? entry : `${entry}${key}`;
  }
  // A lone zero is replaced rather than extended, so the entry never reads `05`. `0` on `0` is refused.
  if (entry === '0') return key === '0' ? entry : key;
  return entry.length >= MAX_WHOLE_DIGITS ? entry : `${entry}${key}`;
}

/** The entry as the decimal it stands for: without a trailing point, which no parser accepts. */
export function entryAmount(entry: string): string {
  return entry.endsWith('.') ? entry.slice(0, -1) : entry;
}

/**
 * How many decimals a step allows: `0.01` → 2, `1` → 0.
 *
 * For a price keypad, sized to the market's tick. Trailing zeros are dropped first, so a tick written
 * `0.010` still allows two. A price with more decimals than the tick could never be a multiple of it.
 */
export function stepDecimals(step: string): number {
  const fraction = step.split('.')[1] ?? '';
  return fraction.replace(/0+$/u, '').length;
}

/** One character of the displayed figure, and the identity it animates under. */
export type EntryGlyph = {
  readonly char: string;
  readonly key: string;
};

/**
 * The entry as the characters to draw, thousands separators included.
 *
 * The keys are what let each character animate on its own, and they are chosen so the right ones stay
 * still. A whole digit is keyed by its position from the left and its value, so typing appends a key
 * and deleting removes one while every digit before it keeps its identity — and a digit that changes
 * value becomes a new key, so it is replaced rather than silently rewritten. A separator is keyed by the
 * group it opens counting from the right, which is the one thing about it that does not change as
 * digits arrive: `9,999` → `99,999` moves the same comma rather than making a new one.
 */
export function entryGlyphs(entry: string): readonly EntryGlyph[] {
  const [whole = '', fraction] = entry.split('.');
  const glyphs: EntryGlyph[] = [];

  for (let index = 0; index < whole.length; index += 1) {
    const remaining = whole.length - index;
    if (index > 0 && remaining % 3 === 0) glyphs.push({ char: ',', key: `group-${remaining / 3}` });
    const digit = whole.charAt(index);
    glyphs.push({ char: digit, key: `whole-${index}-${digit}` });
  }

  if (fraction !== undefined) {
    glyphs.push({ char: '.', key: 'point' });
    for (let index = 0; index < fraction.length; index += 1) {
      const digit = fraction.charAt(index);
      glyphs.push({ char: digit, key: `fraction-${index}-${digit}` });
    }
  }

  return glyphs;
}

/** The entry as a reader would say it, for a screen reader: grouped, with the point kept. */
export function entryText(entry: string): string {
  return entryGlyphs(entryAmount(entry)).map((glyph) => glyph.char).join('');
}
