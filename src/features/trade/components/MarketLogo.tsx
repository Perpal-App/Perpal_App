import { StyleSheet, View } from 'react-native';
import { SvgUri } from 'react-native-svg';

import { radii } from '@/theme/tokens';

/**
 * Fixed so every row's identity block starts at the same x. This is a mark, not
 * a layout dimension, so it does not scale with the reader's text size — the
 * column beside it does.
 */
export const MARKET_LOGO_SIZE = 26;

/**
 * Round venue icon for one market.
 *
 * The URL travels with provider metadata, so this component never invents an
 * image origin. Raster and SVG marks use renderers already present in the app.
 *
 * Pacifica's current catalog is verified against its official asset service.
 * This component deliberately renders no synthetic fallback.
 */
export function MarketLogo({
  size = MARKET_LOGO_SIZE,
  url,
}: {
  readonly size?: number;
  readonly symbol: string;
  readonly url: string;
}) {
  return (
    <View
      // The row composes one accessibility label for all of its content; the
      // mark repeats the symbol beside it and is decorative on its own.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.mark, { width: size, height: size }]}
    >
      {url.length === 0 ? null : (
        <SvgUri
          height="100%"
          uri={url}
          width="100%"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    flexShrink: 0,
    overflow: 'hidden',
    borderRadius: radii.pill,
  },
});
