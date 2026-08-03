import { LinearGradient } from 'expo-linear-gradient';
import {
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, gradients, motion, radii, typography } from '@/theme/tokens';

type GlassButtonProps = {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  /** Cross-fades the button in on mount, handled by the pressable itself. */
  fadeIn?: boolean;
  /** Entrance duration, in ms. Requires `fadeIn`. */
  fadeDuration?: number;
  /** Delay before the entrance starts, in ms. Requires `fadeIn`. */
  fadeDelay?: number;
  /** Distance in px the button slides up as it enters. Requires `fadeIn`. */
  enterOffsetY?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * High-contrast gradient action. The surface is intentionally one opaque layer:
 * no native blur, shadow, or stacked translucent overlays need to be recomposed
 * while the CTA enters on the Reanimated UI thread.
 */
export function GlassButton({
  label,
  onPress,
  accessibilityHint,
  accessibilityLabel = label,
  disabled = false,
  fadeIn = false,
  // Mirrors the pressable's own defaults: `exactOptionalPropertyTypes` rules out
  // forwarding `undefined` to let it fall back to them.
  fadeDuration = motion.fade.duration,
  fadeDelay = 0,
  enterOffsetY = 0,
  style,
}: GlassButtonProps) {
  return (
    <PressableScale
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      enterOffsetY={enterOffsetY}
      fadeDelay={fadeDelay}
      fadeDuration={fadeDuration}
      fadeIn={fadeIn}
      hitSlop={4}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled, style]}
    >
      <LinearGradient
        colors={gradients.primaryAction.colors}
        end={{ x: 1, y: 0.5 }}
        locations={gradients.primaryAction.locations}
        start={{ x: 0, y: 0.5 }}
        style={styles.fill}
      >
        <Text style={styles.label}>{label}</Text>
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 64,
    borderRadius: radii.pill,
  },
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    borderRadius: radii.pill,
  },
  label: {
    ...typography.heading,
    color: colors.textPrimary,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.5,
  },
});
