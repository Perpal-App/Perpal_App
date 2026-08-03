import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

/**
 * The transparent logo, not the packaged app icon: it is a white glyph on alpha,
 * so it sits directly on a coloured field with no plate or corner rounding.
 */
const logoMark = require('../../../assets/AppLogos/Perpal_logo_transparent.png') as ImageSourcePropType;

type BrandMarkProps = {
  showName?: boolean;
  size?: number;
};

export function BrandMark({ showName = false, size = 52 }: BrandMarkProps) {
  return (
    <View
      accessibilityLabel="Perpal"
      accessibilityRole="image"
      style={styles.container}
    >
      <Image
        accessible={false}
        resizeMode="contain"
        source={logoMark}
        style={{ width: size, height: size }}
      />
      {showName ? <Text style={styles.name}>PERPAL</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.eyebrow,
    color: colors.textSecondary,
  },
});
