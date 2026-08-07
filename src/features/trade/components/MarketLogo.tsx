import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { SvgUri } from 'react-native-svg';

import { colors, radii, typography } from '@/theme/tokens';

/**
 * Fixed so every row's identity block starts at the same x. This is a mark, not
 * a layout dimension, so it does not scale with the reader's text size — the
 * column beside it does.
 */
export const MARKET_LOGO_SIZE = 26;

/**
 * Round venue icon for one market.
 *
 * The URL travels with the rest of the market's metadata in the Flash pool
 * config, so this component never invents an image origin. Flash publishes both
 * raster and SVG marks; each uses the renderer already present in the app.
 *
 * A missing or unreachable icon falls back to the symbol's initial. The mark
 * occupies the same box either way, so a row never reflows on a failed load.
 */
export function MarketLogo({
  size = MARKET_LOGO_SIZE,
  symbol,
  url,
}: {
  readonly size?: number;
  readonly symbol: string;
  readonly url: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const isSvg = /\.svg(?:[?#]|$)/iu.test(url);

  return (
    <View
      // The row composes one accessibility label for all of its content; the
      // mark repeats the symbol beside it and is decorative on its own.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.mark, { width: size, height: size }]}
    >
      {!loaded || failed ? (
        <Text style={styles.monogram}>{symbol.slice(0, 1)}</Text>
      ) : null}
      {url.length === 0 || failed ? null : isSvg ? (
        <SvgUri
          height="100%"
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          uri={url}
          width="100%"
        />
      ) : (
        <Image
          fadeDuration={0}
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          resizeMode="contain"
          source={{ cache: 'force-cache', uri: url }}
          style={styles.image}
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  image: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  },
  monogram: {
    position: 'absolute',
    ...typography.eyebrow,
    letterSpacing: 0,
    color: colors.textSecondary,
  },
});
