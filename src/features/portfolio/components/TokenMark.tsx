import { StyleSheet, View } from 'react-native';

import { TokenLogo } from '@/features/portfolio/components/TokenLogo';

/**
 * The disc, which is now the logo itself rather than a container drawn around one.
 *
 * `TokenLogo` already supplies the circle: a pill radius, a hairline rim and `overflow: hidden` over an
 * `expo-image` at `contentFit: cover`. Wrapping it in a second coloured circle would have been two
 * discs deep.
 */
export const TOKEN_DISC = 22;

/**
 * How much the second disc sits over the first.
 *
 * A third of the diameter: enough that the two read as a linked pair rather than two separate marks,
 * and little enough that neither logo is mostly hidden behind the other.
 */
const OVERLAP = 8;

export const TOKEN_PAIR_WIDTH = TOKEN_DISC * 2 - OVERLAP;
export const TOKEN_PAIR_HEIGHT = TOKEN_DISC;

/**
 * A swap's two assets, as their real logos, side by side.
 *
 * Everything drawn here before is gone — the brand colour table, Solana's bars, a plotted dollar sign,
 * Tether's sign built out of rectangles. All of it was the app asserting what a token looks like from a
 * three-value symbol union, which is exactly what `tokenMetadata` forbids in writing: *missing or
 * invalid metadata remains missing; callers must not substitute a bundled mark, initials, or another
 * provider's symbol catalog.* Three hardcoded marks were three ways for the app to be wrong about an
 * asset, and they would never have covered a fourth token.
 *
 * The URLs come from the metadata map the balance refresh already fetches, keyed by the mint the parser
 * now carries. No request was added to make this work.
 *
 * `TokenLogo` renders nothing when a URL is absent or its image fails, and it has no fallback artwork
 * by design. So the caller decides what an unresolvable pair looks like — see `ActivityRow`, which
 * falls back to the generic exchange glyph. That is the action, not a guess at the token.
 */
export function TokenPairMark({
  receivedUrl,
  spentUrl,
}: {
  readonly receivedUrl: string;
  readonly spentUrl: string;
}) {
  return (
    <View style={styles.pair}>
      <TokenLogo size={TOKEN_DISC} url={spentUrl} />
      <TokenLogo size={TOKEN_DISC} style={styles.second} url={receivedUrl} />
    </View>
  );
}

const styles = StyleSheet.create({
  pair: { width: TOKEN_PAIR_WIDTH, height: TOKEN_PAIR_HEIGHT, flexDirection: 'row' },
  // Negative margin rather than absolute positioning: both logos stay in flow, so the row measures the
  // pair's real width and the second cannot escape the box.
  second: { marginLeft: -OVERLAP },
});
