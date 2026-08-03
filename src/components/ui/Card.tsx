import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii, spacing } from '@/theme/tokens';

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Light surface panel with rounded top corners, sized for a bottom sheet. It
 * stays layout-only: callers decide where it sits and what goes inside.
 */
export function Card({ children, style }: CardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.lightAction,
    borderTopLeftRadius: radii.panel,
    borderTopRightRadius: radii.panel,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
  },
});
