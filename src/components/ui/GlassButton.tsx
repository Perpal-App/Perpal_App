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
 * The app's primary action, cut from the same material as the order buttons: a ramp from a lit top
 * edge to a deeper base.
 *
 * It used to be translucent — a darkening tint the backdrop showed through. That read as a panel
 * over the gradient rather than as a control on it, and it meant the one button on the screen was
 * the only thing on it made of nothing. The material is the accent now, so a primary action looks
 * the same here as it does on a market.
 *
 * What stays is the glass finish and the way it behaves: the specular highlight along the top edge
 * that fades out before the midpoint, so the surface reads as curved rather than flat; the spring
 * press; and the composited fade-and-rise entrance. Those are what make it feel like glass, and
 * none of them depended on the fill being see-through.
 *
 * Sized down to a single line of `label` type at 52pt tall. The 64pt height came from the pill this
 * replaced, where the height was the shape; on a rounded rectangle the same height is just a slab.
 * The radius is proportional to the order buttons' rather than equal to it — those are 42pt on
 * `radii.sm`, a touch under a quarter of their height, so `radii.md` at 52 holds the same ratio.
 */
export function GlassButton({
  label,
  onPress,
  accessibilityHint,
  accessibilityLabel = label,
  disabled = false,
  fadeIn = false,
  // Mirrors the pressable's own defaults: `exactOptionalPropertyTypes` rules out forwarding
  // `undefined` to let it fall back to them.
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
        colors={gradients.accentAction.colors}
        end={{ x: 0.5, y: 1 }}
        locations={gradients.accentAction.locations}
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
  // No rim. The order buttons carry one because two of them sit side by side and each needs an
  // edge against the other; this is one control alone on a gradient, where the same stroke reads as
  // an outline drawn around the button rather than as its side. The ramp's own dark base is what
  // separates it from the page now.
  button: {
    height: 52,
    borderRadius: radii.md,
    // A circular corner meets the straight edge at an abrupt change in curvature; a continuous
    // corner eases into it, which at this radius is the difference between a rounded rectangle and
    // a rectangle with its corners cut off.
    borderCurve: 'continuous',
    // Keeps the ramp and its sheen inside the corners.
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
  // `label` on the semibold face rather than `heading` on bold. At 64pt tall the heavier, larger
  // type was what the height was built around; at 52 it filled the button, and a label that crowds
  // its own control is most of what made this read as bulky.
  label: {
    ...typography.label,
    color: colors.onAccent,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.5,
  },
});
