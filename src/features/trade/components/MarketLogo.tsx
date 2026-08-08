import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

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
 * The URL travels with provider metadata, so this component never invents an image
 * origin. Pacifica's current catalog is verified against its official asset service, and
 * this component deliberately renders no synthetic fallback.
 *
 * Decoding belongs to `expo-image` rather than to `react-native-svg`'s `SvgUri`, which
 * this used to use. `SvgUri` fetches and parses the document in JavaScript on every mount
 * and caches nothing, so a list of a hundred and fifty markets meant a hundred and fifty
 * fetches and XML parses on the JS thread — repeated each time a cell was recycled. That
 * is what made the markets list seize up the further it was scrolled, and it starved the
 * tab bar's animations at the same time, because those animate layout properties and so
 * depend on the same thread being free to commit. `expo-image` decodes natively and off
 * that thread, and the cache means each mark is decoded once per process.
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
        <Image
          // Decoded once per process and kept across scrolls, which is the whole point:
          // recycling a cell must not mean fetching and decoding the mark again.
          cachePolicy="memory-disk"
          contentFit="contain"
          // Tells expo-image the view is being reused for a different market, so it drops
          // the previous mark instead of leaving it up until the new one resolves.
          recyclingKey={url}
          source={url}
          style={styles.image}
          // No cross-fade. In a scrolling list every recycled cell would play one, which
          // reads as the whole column flickering rather than as anything arriving.
          transition={0}
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
  image: { width: '100%', height: '100%' },
});
