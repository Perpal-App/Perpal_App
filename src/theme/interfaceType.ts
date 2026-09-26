import { Platform, type TextStyle } from 'react-native';

/**
 * The interface type scale: the platform's own face — San Francisco on iOS, Roboto on Android — for the
 * surfaces where figures are the point. Today that is the order ticket and everything in its sheet.
 *
 * Poppins stays the brand face everywhere else. It is a geometric display family: wide, round, and with
 * proportional figures only and no `tnum` feature, so an amount changes width as its digits change and a
 * column of prices never lines up. A trading form is read digit by digit, and that is where it showed.
 * San Francisco and Roboto are drawn for interface text at exactly these sizes, carry tabular figures, and
 * are already on the device: nothing is bundled and nothing is loaded at runtime, and the reader's text
 * size scales them like the rest of the system.
 *
 * Every number role sets `tabular-nums`, so each digit takes the same width and a figure holds still while
 * it changes: a price ticking, an amount being typed, a column of values ending on the same edge. Text
 * roles do not, because tabular spacing inside words reads as gappy.
 *
 * Weight is chosen with `fontWeight`, unlike the Poppins roles in `./fonts`: the system face is one family
 * with real weights on both platforms, so asking for 600 gets the real semibold. Sizes and leading follow
 * the iOS text styles. Text roles set no tracking, because San Francisco tracks itself by size and any
 * value here would add to that; only the large figures are pulled in, where display sizes read loose.
 *
 * Hierarchy comes from size and weight, and from colour at the call site: a label in a secondary colour at
 * regular weight, its value in the primary colour at semibold. Sentence case throughout; nothing here is
 * set in capitals.
 */
const FACE = Platform.select({ ios: 'System', default: 'sans-serif' });
const TABULAR: TextStyle['fontVariant'] = ['tabular-nums'];

export const interfaceType = {
  // Words.

  /** The sheet's title and a page header: `SOL-USD`, `Review order`. */
  headline: { fontFamily: FACE, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  /** A heading inside the sheet: the receipt's outcome, the deposit form's title. */
  title: { fontFamily: FACE, fontSize: 20, lineHeight: 25, fontWeight: '600' },
  /** An option's name: `Leverage`, `Auto close`. */
  rowTitle: { fontFamily: FACE, fontSize: 16, lineHeight: 21, fontWeight: '500' },
  /** A figure's name beside its value, and sentences: `Position size`. */
  body: { fontFamily: FACE, fontSize: 15, lineHeight: 20, fontWeight: '400' },
  /** Secondary lines: an option's state, notes, errors under a field. */
  caption: { fontFamily: FACE, fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** What a card or a section holds, in sentence case: `Collateral`, `Take profit`, `Order`. */
  overline: { fontFamily: FACE, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  /** A word that can be pressed inside the sheet: `Clear`, `Done`, a token's ticker beside its mark. */
  control: { fontFamily: FACE, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  /** The label on the ticket's primary action. */
  action: { fontFamily: FACE, fontSize: 17, lineHeight: 22, fontWeight: '600' },

  // Numbers. Every one tabular.

  /** The amount being entered: the collateral. */
  amount: {
    fontFamily: FACE,
    fontSize: 44,
    lineHeight: 52,
    fontWeight: '600',
    letterSpacing: -1.1,
    fontVariant: TABULAR,
  },
  /** The multiple being chosen on the leverage editor. */
  amountLarge: {
    fontFamily: FACE,
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '600',
    letterSpacing: -1,
    fontVariant: TABULAR,
  },
  /** The unit beside a large figure, a step down so the number leads: the `×` of `5×`. */
  amountUnit: { fontFamily: FACE, fontSize: 24, lineHeight: 30, fontWeight: '500', fontVariant: TABULAR },
  /** A price typed into a field: a take profit or a stop loss. */
  amountField: {
    fontFamily: FACE,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.4,
    fontVariant: TABULAR,
  },
  /** A figure's value beside its name, and an option's value: `$120.68`, `5×`. */
  figure: { fontFamily: FACE, fontSize: 15, lineHeight: 20, fontWeight: '600', fontVariant: TABULAR },
  /** An estimate under a price: the profit or loss at a take profit or a stop loss. */
  figureStrong: { fontFamily: FACE, fontSize: 14, lineHeight: 18, fontWeight: '600', fontVariant: TABULAR },
  /** Figures in a secondary line: `0 USDC`, `Available balance: $13.10`, a slider's bounds. */
  figureCaption: { fontFamily: FACE, fontSize: 13, lineHeight: 18, fontWeight: '400', fontVariant: TABULAR },
  /** An estimate on its badge: `+$91.50`. */
  badge: { fontFamily: FACE, fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: TABULAR },
  /** A preset share on its chip: `25%`, `Max`. */
  chip: { fontFamily: FACE, fontSize: 14, lineHeight: 18, fontWeight: '500', fontVariant: TABULAR },
  /**
   * The keypad's digits. Regular rather than bold, the weight a phone's own keypad uses: twelve heavy keys
   * would outshout the figure they write.
   */
  keypad: { fontFamily: FACE, fontSize: 28, lineHeight: 34, fontWeight: '400', fontVariant: TABULAR },
} as const satisfies Record<string, TextStyle>;
