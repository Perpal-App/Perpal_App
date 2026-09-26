import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors, motion } from '@/theme/tokens';

/** Composited box for the mark. A transform, so the ring's overshoot costs no layout pass. */
const MARK_BOX = 76;
const RING_FROM_SCALE = 0.62;
const TICK_FROM_SCALE = 0.7;
/** The tick follows the ring rather than arriving with it, so the two read as one gesture landing. */
const TICK_DELAY_MS = 110;

/**
 * A ring, then the tick inside it.
 *
 * The ring springs in on `motion.spring`, which is underdamped and so carries one soft overshoot — the
 * app's existing shape for a confirmation, the same overshoot the bookmark uses when something is saved.
 * The tick is the toast's own success path scaled about the centre of the box, so a success here and a
 * success in the toast bar are recognisably the same mark.
 *
 * Scale and opacity only, on the UI thread. Under reduce motion both land on their final values on the
 * first frame, so the state is conveyed without any movement at all.
 */
export function PlacedCheckmark() {
  const reduceMotion = useReducedMotion();
  const ring = useSharedValue(reduceMotion ? 1 : 0);
  const tick = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      ring.set(1);
      tick.set(1);
      return;
    }
    ring.set(withSpring(1, motion.spring));
    tick.set(withDelay(
      TICK_DELAY_MS,
      withTiming(1, { duration: motion.bookmarkToggle.fillInMs, easing: Easing.out(Easing.cubic) }),
    ));
  }, [reduceMotion, ring, tick]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value,
    transform: [{ scale: RING_FROM_SCALE + (1 - RING_FROM_SCALE) * ring.value }],
  }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ scale: TICK_FROM_SCALE + (1 - TICK_FROM_SCALE) * tick.value }],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.mark}
    >
      <Animated.View style={[styles.layer, ringStyle]}>
        <Svg height={MARK_BOX} viewBox="0 0 24 24" width={MARK_BOX}>
          <Circle cx={12} cy={12} fill="none" r={10.6} stroke={colors.positive} strokeWidth={1.5} />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.layer, tickStyle]}>
        <Svg height={MARK_BOX} viewBox="0 0 24 24" width={MARK_BOX}>
          <Path
            d="M7.05 12.15 10.45 15.4 16.95 8.6"
            fill="none"
            stroke={colors.positive}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.9}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { width: MARK_BOX, height: MARK_BOX, alignItems: 'center', justifyContent: 'center' },
  // Stacked rather than one SVG with two children, so the ring and the tick can carry their own
  // transforms. Absolute keeps both on the box's centre while they scale.
  layer: { position: 'absolute' },
});
