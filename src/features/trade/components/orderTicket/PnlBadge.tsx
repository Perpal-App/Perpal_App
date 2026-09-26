import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useRetainedValue } from '@/components/motion/useRetainedValue';
import { signedDollars, type PnlFigure } from '@/features/trade/components/orderTicket/autoClosePnl';
import { PNL_INK } from '@/features/trade/components/orderTicket/PnlIndicator';
import { colors, interfaceType, motion, radii } from '@/theme/tokens';

/** Tight to the figure: a badge carrying a few characters, not a button. */
const PAD_X = 6;
const PAD_Y = 1;

/** The badge's height, for a caller that seats it across an edge by half of it. */
export const PNL_BADGE_HEIGHT = interfaceType.badge.lineHeight + PAD_Y * 2;

/** How much of the ink washes the pill: enough to read as green or red at a glance, never a solid block. */
const TINT_OPACITY = 0.16;

/** The size it grows from as it arrives, so it settles onto its corner rather than only fading up. */
const FROM_SCALE = 0.85;

/** A long estimate shrinks to fit rather than being cut off, down to this share. */
const MIN_FIT = 0.8;

/** Caps the badge's text scale, so at the largest sizes it stays a badge rather than a banner. */
const TEXT_SCALE = 1.3;

/**
 * An estimated profit or loss as a small floating pill: `+$91.50` in green, `−$3.07` in red.
 *
 * The sign carries the direction, so the badge never relies on colour alone, and the pill is washed in the
 * same colour on an opaque base, so it reads cleanly over whatever edge it sits on. It pops in when there is
 * an estimate and fades out when there is none — keeping what it said while it goes — and takes no touches.
 * Decorative for assistive tech: the field it sits on speaks the estimate as part of its own label.
 */
export function PnlBadge({ figure }: { readonly figure: PnlFigure | null }) {
  const reduceMotion = useReducedMotion();
  const text = figure === null ? null : signedDollars(figure);
  // Strings, not the figure object, which is rebuilt every render and would never compare equal.
  const shownText = useRetainedValue(text);
  const shownDirection = useRetainedValue(figure === null ? null : figure.direction);
  const visible = text !== null;
  const shown = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    const target = visible ? 1 : 0;
    shown.set(reduceMotion ? target : withTiming(target, { duration: motion.rowSwap.fadeMs }));
  }, [reduceMotion, shown, visible]);

  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ scale: FROM_SCALE + (1 - FROM_SCALE) * shown.value }],
  }));

  if (shownText === null || shownDirection === null) return null;
  const ink = PNL_INK[shownDirection];

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.badge, style]}
    >
      <View style={[styles.tint, { backgroundColor: ink }]} />
      <Text
        adjustsFontSizeToFit
        maxFontSizeMultiplier={TEXT_SCALE}
        minimumFontScale={MIN_FIT}
        numberOfLines={1}
        style={[styles.value, { color: ink }]}
      >
        {shownText}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Opaque under the wash, so a field's rim running behind the badge does not show through it. Never wider
  // than the space it is given, which is what lets a long figure shrink to fit instead of overflowing.
  badge: {
    maxWidth: '100%',
    overflow: 'hidden',
    paddingHorizontal: PAD_X,
    paddingVertical: PAD_Y,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  tint: { position: 'absolute', inset: 0, opacity: TINT_OPACITY },
  value: interfaceType.badge,
});
