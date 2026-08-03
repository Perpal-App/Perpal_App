import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, layout } from '@/theme/tokens';

type IconButtonTone = 'accent' | 'dark' | 'light' | 'surface';

type IconButtonProps = {
  accessibilityLabel: string;
  children: ReactNode;
  onPress: () => void;
  accessibilityHint?: string;
  size?: number;
  tone?: IconButtonTone;
};

export function IconButton({
  accessibilityLabel,
  children,
  onPress,
  accessibilityHint,
  size = 64,
  tone = 'surface',
}: IconButtonProps) {
  const resolvedSize = Math.max(size, layout.minTouchTarget);

  return (
    <PressableScale
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={[
        styles.base,
        styles[tone],
        {
          width: resolvedSize,
          height: resolvedSize,
          borderRadius: resolvedSize / 2,
        },
      ]}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        {children}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  accent: {
    backgroundColor: colors.accent,
  },
  dark: {
    backgroundColor: colors.darkAction,
  },
  light: {
    backgroundColor: colors.lightAction,
  },
  surface: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.scrim,
  },
});
