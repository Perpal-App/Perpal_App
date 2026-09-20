import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import type { WalletAssetAmount } from '@/integrations/solana/solanaWalletActivityParser';
import { colors, radii } from '@/theme/tokens';

type TokenSymbol = WalletAssetAmount['symbol'];

/**
 * Third-party brand colours, held here rather than in the theme.
 *
 * These are not the app's palette and must not be reachable from it — a semantic token is something
 * a screen is allowed to reuse, and Tether's green is not available for a rising price. They live
 * beside the only marks that draw them.
 */
const BRAND: Readonly<Record<TokenSymbol, string>> = {
  SOL: '#9945FF',
  USDC: '#2775CA',
  USDT: '#26A17B',
};

/**
 * The disc, at 22 rather than the 15 it started at.
 *
 * What paid for it: the row's title column is squeezed by the amount beside it, so widening the mark
 * slot costs title width — but 7 of the feed's 22 titles were already over that column at the old
 * width and already wrapping to two lines. The one title that shares a row with a *pair* is
 * "Swapped", at 67pt against a 144pt column, so the row this actually appears on has width to spare.
 * 36pt of slot is where the disc gets meaningfully bigger while only two more of the long
 * balance-event titles cross the wrap threshold.
 */
export const TOKEN_DISC = 22;

/**
 * How much the second disc sits over the first.
 *
 * A third of the diameter: enough that the two read as a linked pair rather than two separate marks,
 * and little enough that neither brand colour is mostly hidden behind the other.
 */
const OVERLAP = 8;

export const TOKEN_PAIR_WIDTH = TOKEN_DISC * 2 - OVERLAP;
export const TOKEN_PAIR_HEIGHT = TOKEN_DISC;

/**
 * Render size of each glyph's 24-unit box inside the disc.
 *
 * Solved rather than picked. The three marks ink different amounts of their box — Solana's bars are
 * 18x15 units, Tether's sign 15x16, the dollar 10x18 — and at 0.64 all three land within a point of
 * the same ink height, so no one token looks bigger than the others in the column. Comfortably under
 * the disc, which is what makes clipping impossible rather than merely unlikely.
 */
const GLYPH = Math.round(TOKEN_DISC * 0.64);

/** Solana's three bars, alternating lean, on the 3–21 ink grid every mark in the app uses. */
const SOL_BARS = 'M6 4.5H21L18 7.5H3ZM3 10.5H18L21 13.5H6ZM6 16.5H21L18 19.5H3Z';

/**
 * A dollar sign, drawn.
 *
 * It was the character in a `Text` sized at 1.15 of the box it sat in — a 23pt glyph inside a 20pt
 * view — so the bottom of it was cut off. Drawing it on the same 24-unit grid as its neighbours
 * removes the whole class of problem: no font metric, no line box, no ascent to reconcile, and nothing
 * that can overflow its frame.
 */
const DOLLAR_STEM = 'M12 3.2V20.8';
const DOLLAR_S = 'M16.8 6.8H10.4a3.3 3.3 0 0 0 0 6.6h3.2a3.3 3.3 0 0 1 0 6.6H7.2';

/**
 * Tether's sign, drawn.
 *
 * It was the character `₮`, over a comment asserting the bundled Poppins carried it. It does not —
 * U+20AE is absent from all four bundled faces — so every USDT mark was falling through to whatever
 * the platform substituted, in a typeface that is not this app's.
 */
function TetherMark() {
  return (
    <>
      <Rect fill={colors.onAccent} height={3} rx={1.5} width={15} x={4.5} y={4} />
      <Rect fill={colors.onAccent} height={16} rx={1.5} width={3} x={10.5} y={4} />
      <Rect fill={colors.onAccent} height={2.5} rx={1.25} width={10} x={7} y={10.5} />
    </>
  );
}

function DollarMark() {
  const stroke = { fill: 'none', stroke: colors.onAccent, strokeLinecap: 'round', strokeWidth: 3.2 } as const;

  return (
    <>
      <Path {...stroke} d={DOLLAR_STEM} />
      <Path {...stroke} d={DOLLAR_S} />
    </>
  );
}

/**
 * One asset, as its brand disc with a white mark in it.
 *
 * The disc is the logo for two of the three — USDC and USDT are both a sign inside a filled circle —
 * so drawing them bare made them less recognisable, not more. What it needed was to be bigger.
 *
 * All three glyphs are drawn rather than set, which is what makes the disc authoritative: the mark is
 * exactly `GLYPH` across and the disc `TOKEN_DISC`, so it cannot be clipped by the circle that clips
 * the fill.
 */
export function TokenMark({
  style,
  symbol,
}: {
  readonly style?: object;
  readonly symbol: TokenSymbol;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.disc, { backgroundColor: BRAND[symbol] }, style]}
    >
      <Svg height={GLYPH} viewBox="0 0 24 24" width={GLYPH}>
        {symbol === 'SOL' ? <Path d={SOL_BARS} fill={colors.onAccent} /> : null}
        {symbol === 'USDT' ? <TetherMark /> : null}
        {symbol === 'USDC' ? <DollarMark /> : null}
      </Svg>
    </View>
  );
}

/**
 * A swap's two assets, side by side, the received one overlapping the spent.
 *
 * Horizontal, sharing a baseline, which is the arrangement a pair of tokens is read in everywhere
 * else. A previous attempt stacked them vertically to avoid spending any title width at all; the
 * saving was not worth a pair that reads as two unrelated marks in a column.
 */
export function TokenPairMark({
  received,
  spent,
}: {
  readonly received: TokenSymbol;
  readonly spent: TokenSymbol;
}) {
  return (
    <View style={styles.pair}>
      <TokenMark symbol={spent} />
      <TokenMark style={styles.second} symbol={received} />
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    width: TOKEN_DISC,
    height: TOKEN_DISC,
    flexShrink: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  pair: { width: TOKEN_PAIR_WIDTH, height: TOKEN_PAIR_HEIGHT, flexDirection: 'row' },
  // Negative margin rather than absolute positioning: both discs stay in flow, so the row measures
  // the pair's real width and the second cannot escape the box the way an absolute child can.
  second: { marginLeft: -OVERLAP },
});
