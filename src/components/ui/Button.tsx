import { StyleSheet, Text } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, layout, motion, radii, spacing, typography } from '@/theme/tokens';

type ButtonVariant = 'primary' | 'secondary';

type ButtonProps = {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
  disabled?: boolean;
  variant?: ButtonVariant;
  /**
   * Scale the button shrinks to while pressed. Pass `1` for no press animation.
   * Mirrors the pressable's own default: `exactOptionalPropertyTypes` rules out
   * forwarding `undefined` to fall back to it.
   */
  pressedScale?: number;
};

export function Button({
  label,
  onPress,
  accessibilityHint,
  disabled = false,
  variant = 'primary',
  pressedScale = motion.pressScale,
}: ButtonProps) {
  return (
    <PressableScale
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      pressedScale={pressedScale}
      style={[
        styles.base,
        variant === 'primary' ? styles.primary : styles.secondary,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.label,
          variant === 'primary' ? styles.primaryLabel : styles.secondaryLabel,
        ]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    minWidth: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    ...typography.label,
    textAlign: 'center',
  },
  primaryLabel: {
    color: colors.onAccent,
  },
  secondaryLabel: {
    color: colors.textPrimary,
  },
});
