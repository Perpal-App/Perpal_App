import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

const appIcon = require('../../../assets/icon.png') as ImageSourcePropType;

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
        source={appIcon}
        style={{ width: size, height: size, borderRadius: size * 0.27 }}
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
