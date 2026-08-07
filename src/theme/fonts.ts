/**
 * Font tokens — the single place font faces are named.
 *
 * Import a face directly wherever one is needed:
 *   `import { fonts } from '@/theme/fonts';`  →  `fontFamily: fonts.semiBold`
 * or take a whole role from the scale:
 *   `import { typography } from '@/theme/fonts';`  →  `...typography.label`
 * (`@/theme/tokens` re-exports both, so either import path works.)
 *
 * Two rules hold this file together:
 *
 * 1. A face is selected by name, never by `fontWeight`. Google's Poppins ships
 *    Medium and SemiBold under their own legacy family names ("Poppins Medium"),
 *    so `fontFamily: 'Poppins'` + `fontWeight: '600'` resolves to Regular on iOS
 *    and to a synthetically emboldened Regular on Android. Naming the exact face
 *    ("Poppins-SemiBold") resolves the real file on both platforms: iOS matches
 *    the PostScript name, Android matches the family registered by the expo-font
 *    plugin in app.config.ts. Never add `fontWeight` next to these families.
 *
 * 2. Every line leads at ~1.5x its size. Poppins' glyph box is 1.4em tall
 *    (ascender 1.05em + descender 0.35em) and its natural line is 1.5em; Android
 *    crops a line whose `lineHeight` is shorter than the glyph box, which is how
 *    descenders and accents get shaved. Patrick Hand's box is 1.36em, so the
 *    wordmark leads at that instead. Keep any local override on the same ratio.
 */

export const fonts = {
  regular: 'Poppins-Regular',
  medium: 'Poppins-Medium',
  semiBold: 'Poppins-SemiBold',
  bold: 'Poppins-Bold',
  /** Handwritten face, reserved for the Perpal wordmark. */
  brand: 'PatrickHand-Regular',
} as const;

export type FontFace = (typeof fonts)[keyof typeof fonts];

export const typography = {
  wordmark: {
    // Patrick Hand is a handwriting face; heavy tracking breaks its flow, so
    // the letters keep only a light, breathable gap. Sized to read as a brand
    // mark without competing with the headline below it.
    fontFamily: fonts.brand,
    fontSize: 46,
    lineHeight: 63,
    letterSpacing: 1.5,
  },
  display: {
    fontFamily: fonts.bold,
    fontSize: 36,
    lineHeight: 54,
    letterSpacing: -1,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 26,
    lineHeight: 39,
    letterSpacing: -0.6,
  },
  heading: {
    fontFamily: fonts.semiBold,
    fontSize: 18,
    lineHeight: 27,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 23,
    letterSpacing: 0,
  },
  bodyCompact: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: 0,
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: 0,
  },
  /**
   * Secondary line inside a dense row: the figure that qualifies the value
   * above it (a 24h move under a price, open interest under volume) or the
   * instrument name under its symbol.
   */
  caption: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
  },
  /**
   * All-caps column headers and metric labels. Caps have no descenders, so this
   * is the one role that can lead slightly under 1.5x without cropping.
   */
  eyebrow: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1,
  },
} as const;
