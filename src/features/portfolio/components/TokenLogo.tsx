import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useState } from 'react';

import { colors, radii } from '@/theme/tokens';

export const TOKEN_LOGO_SIZE = 28;

/** Remote token mark returned by the wallet metadata RPC. Deliberately has no fallback artwork. */
export function TokenLogo({
  size = TOKEN_LOGO_SIZE,
  style,
  url,
}: {
  readonly size?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly url: string | null;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (url === null || failedUrl === url) return null;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, { height: size, width: size }, style]}
    >
      <Image
        cachePolicy="memory-disk"
        contentFit="cover"
        onError={() => setFailedUrl(url)}
        recyclingKey={url}
        source={url}
        style={styles.image}
        transition={0}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    borderRadius: radii.pill,
    backgroundColor: 'transparent',
  },
  image: { width: '100%', height: '100%' },
});
