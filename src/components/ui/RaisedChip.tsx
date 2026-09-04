import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, gradients, motion, radii, spacing } from '@/theme/tokens';

/**
 * Deeper than the app's 0.96 default, and on a slacker spring. Six percent is enough displacement to
 * feel the chip give under a thumb, and `pressGooey` lets it come back through one overshoot instead
 * of stopping dead. Both run as shared values on the UI thread, so neither waits on JS.
 */
const PRESSED_SCALE = 0.94;

/**
 * A raised pill in the app's accent, seated on its surface rather than hovering over it.
 *
 * Three layers, no border:
 *
 * 1. `accentAction` as a vertical ramp — the same material every raised accent control in the app is
 *    cut from, lighter at the top edge than at the base so the fill reads as a curved surface.
 * 2. `glassActionSheen` over it, fading out before the midpoint. This is the specular a rim used to
 *    fake, and a gradient rather than `borderTopWidth` because a border draws on all four sides or
 *    none, and light does not arrive from four directions.
 * 3. A contact shadow underneath: offset 2, radius 4. Short and close on purpose — the wide, soft,
 *    far-offset shadow it replaced is exactly what made these read as floating. A shadow this tight
 *    reads as the chip touching the card.
 *
 * Deliberately the legacy `shadow*` and `elevation` props rather than `boxShadow`. `boxShadow` is the
 * better API, but it needs the New Architecture and fails silently without it — which is what left
 * these looking flat. These work on both architectures and both platforms.
 *
 * `elevation` is Android's only shadow, and it will not draw from a view with no background. Hence the
 * `backgroundColor` on the outer view: the gradient child covers it completely, so it is never seen,
 * but without it Android has nothing to cast from.
 */
export function RaisedChip({
  accessibilityHint,
  accessibilityLabel,
  children,
  contentStyle,
  onPress,
  style,
}: {
  readonly accessibilityHint?: string;
  readonly accessibilityLabel: string;
  readonly children: ReactNode;
  /** Inner layout — gap and horizontal inset. The outer `style` sizes the chip. */
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly onPress: () => void;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <PressableScale
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      pressSpring={motion.pressGooey}
      pressedScale={PRESSED_SCALE}
      style={[styles.chip, style]}
    >
      {/* The ramp is a child rather than the pressable itself, so the shadow on the parent is not
          clipped by the `overflow` this needs to keep the fill inside the corner. */}
      <LinearGradient
        colors={gradients.accentAction.colors}
        end={{ x: 0.5, y: 1 }}
        locations={gradients.accentAction.locations}
        start={{ x: 0.5, y: 0 }}
        style={[styles.fill, contentStyle]}
      >
        <LinearGradient
          colors={gradients.glassActionSheen.colors}
          end={{ x: 0.5, y: 1 }}
          locations={gradients.glassActionSheen.locations}
          pointerEvents="none"
          start={{ x: 0.5, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {children}
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radii.pill,
    // Never visible — the gradient child covers it. Present so Android's `elevation` has a surface to
    // throw from, and taken from the ramp's own base so a partial paint cannot flash a foreign colour.
    backgroundColor: gradients.accentAction.colors[1],
    shadowColor: colors.raisedHalo,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 3,
  },
  fill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
  },
});
