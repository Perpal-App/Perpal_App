import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { WalletAssetAmount } from '@/integrations/solana/solanaWalletActivityParser';
import { colors, fonts, radii } from '@/theme/tokens';

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
 * Solana's three bars, alternating lean, on the 3–21 ink grid shared by every mark in the app.
 *
 * Drawn rather than fetched. `WalletAssetAmount` carries a symbol from a closed three-value union and
 * no mint, so the remote logo the balance tiles use would need a config lookup to resolve a mint and
 * a metadata response to resolve a URL — and `TokenLogo` renders nothing when either is missing, so
 * the pair would silently vanish on a cold cache. A local mark cannot be absent.
 */
const SOL_BARS = 'M6.2 6H21L17.8 8.6H3ZM3 10.7H17.8L21 13.3H6.2ZM6.2 15.4H21L17.8 18H3Z';

/**
 * A stablecoin's sign, for the two marks a glyph would not tell apart.
 *
 * `$` and `₮` as characters rather than paths. Blocked out as rectangles the two are near enough to
 * each other to be a coin toss at 16pt, where the real signs are unmistakable, and the bundled
 * Poppins carries both.
 */
const SIGN: Readonly<Record<TokenSymbol, string | null>> = {
  SOL: null,
  USDC: '$',
  USDT: '₮',
};

/**
 * One asset, as a brand-coloured disc.
 *
 * Used where an amount's symbol would otherwise be spelled out twice on the same row — a swap names
 * two assets, and printing the pair in the title as well as on the figures said each one three times
 * over. The disc states it once.
 */
export function TokenMark({
  size,
  style,
  symbol,
}: {
  readonly size: number;
  readonly style?: object;
  readonly symbol: TokenSymbol;
}) {
  const sign = SIGN[symbol];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.disc,
        { width: size, height: size, backgroundColor: BRAND[symbol] },
        style,
      ]}
    >
      {sign === null ? (
        <Svg height={size * 0.6} viewBox="0 0 24 24" width={size * 0.6}>
          <Path d={SOL_BARS} fill={colors.onAccent} />
        </Svg>
      ) : (
        <Text
          // Never scales with the OS text setting: this is a mark, and a sign that grew past its own
          // disc would be clipped by it rather than becoming easier to read.
          allowFontScaling={false}
          style={[styles.sign, { fontSize: Math.round(size * 0.62) }]}
        >
          {sign}
        </Text>
      )}
    </View>
  );
}

/**
 * A swap's two assets, the second overlapping the first.
 *
 * Overlapped rather than spaced so the pair occupies one mark slot: every title in the feed starts at
 * the same x, and a pair that was wider than the single glyphs beside it would step the whole column
 * in and out row by row.
 */
export function TokenPairMark({
  received,
  size,
  spent,
}: {
  readonly received: TokenSymbol;
  readonly size: number;
  readonly spent: TokenSymbol;
}) {
  return (
    <View style={styles.pair}>
      <TokenMark size={size} symbol={spent} />
      <TokenMark size={size} style={{ marginLeft: -Math.round(size * 0.34) }} symbol={received} />
    </View>
  );
}

/** Width of a pair at a given disc size, so a caller can size the slot without guessing. */
export function tokenPairWidth(size: number): number {
  return size * 2 - Math.round(size * 0.34);
}

const styles = StyleSheet.create({
  disc: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: radii.pill,
  },
  sign: {
    fontFamily: fonts.semiBold,
    color: colors.onAccent,
    // Matches the glyph box so the sign sits on the disc's centre rather than on its own baseline.
    textAlign: 'center',
    includeFontPadding: false,
  },
  pair: { flexDirection: 'row', alignItems: 'center' },
});
