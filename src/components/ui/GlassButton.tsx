import { LinearGradient } from 'expo-linear-gradient';
import {
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, fonts, gradients, motion, radii, typography } from '@/theme/tokens';

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
 * Translucent glass action. The backdrop shows through a darkening tint, with a
 * specular sheen along the top edge and a tinted rim instead of a hard outline.
 *
 * The glass is built from translucent gradients rather than a native blur. What
 * sits behind this button is a smooth gradient, so there is no detail for a blur
 * to soften: it would cost a native blur pass on every frame of the entrance
 * animation and look the same. A screen that puts real content behind a glass
 * surface would want `expo-blur` instead.
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
        colors={gradients.glassAction.colors}
        end={{ x: 0.5, y: 1 }}
        locations={gradients.glassAction.locations}
        start={{ x: 0.5, y: 0 }}
        style={styles.fill}
      >
        <LinearGradient
          colors={gradients.glassActionSheen.colors}
          end={{ x: 0.5, y: 1 }}
          locations={gradients.glassActionSheen.locations}
          pointerEvents="none"
          start={{ x: 0.5, y: 0 }}
          style={styles.sheen}
        />

        <Text style={styles.label}>{label}</Text>
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 64,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.glassEdge,
    // Keeps the translucent fill and its sheen inside the pill.
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  label: {
    ...typography.heading,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.5,
  },
});
