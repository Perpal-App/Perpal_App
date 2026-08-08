import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { colors, gradients, motion, radii } from '@/theme/tokens';

/**
 * Ticks in the gauge. Thirty-six divides the scale finely enough that a reading moves the
 * fill by an obvious amount, while leaving each tick wide enough to still be a mark rather
 * than a hairline on the narrowest phone the app supports.
 */
const TICK_COUNT = 36;
const TICKS = Array.from({ length: TICK_COUNT }, (_, index) => index);

export const GAUGE_HEIGHT = 20;
/**
 * Half of `radii.xs`, because a tick is a fraction of the width that token was judged
 * against: the same radius that takes the point off a search field's corner rounds a mark
 * this narrow almost to a pill, and a row of pills reads as beads rather than as a gauge.
 */
export const TICK_RADIUS = radii.xs / 2;
/** How short a tick starts before it rises into place. */
const TICK_REST_SCALE = 0.34;

/**
 * A 0–100 reading as a row of ticks, filled up to the value in one colour.
 *
 * The track is complete from the first frame and the colour is a separate layer over it, so
 * the fill animation sweeps across a gauge that is already there rather than assembling one.
 * Building the row itself would have been the more obvious animation and the wrong one — a
 * gauge that arrives a piece at a time cannot be read until it stops moving.
 *
 * Every tick's colour layer is driven from one shared value, and each derives its own slice
 * of it from its index. So the sweep costs a single animation no matter how many ticks are
 * lit, and they cannot drift out of step with each other.
 */
export function SentimentGauge({
  tone,
  value,
}: {
  readonly tone: ColorValue;
  readonly value: number;
}) {
  const reduceMotion = useReducedMotion();
  const fill = useSharedValue(reduceMotion ? 1 : 0);
  const lit = Math.round((Math.min(Math.max(value, 0), 100) / 100) * TICK_COUNT);

  useEffect(() => {
    if (reduceMotion) {
      fill.set(1);
      return;
    }

    // Keyed on the reading, so a new one sweeps again rather than appearing already filled.
    fill.set(0);
    fill.set(
      withTiming(1, {
        duration: motion.gaugeFill.duration,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [fill, reduceMotion, value]);

  return (
    <View style={styles.gauge}>
      {TICKS.map((index) => (
        <Tick fill={fill} index={index} key={index} lit={lit} tone={tone} />
      ))}
    </View>
  );
}

function Tick({
  fill,
  index,
  lit,
  tone,
}: {
  readonly fill: SharedValue<number>;
  readonly index: number;
  readonly lit: number;
  readonly tone: ColorValue;
}) {
  const isLit = index < lit;
  // The window of the sweep this tick rises in. Spread so the last one finishes exactly as
  // the sweep ends, which is what makes the front arrive at the reading rather than past it.
  const span = Math.max(lit - 1, 1);
  const start = (index / span) * (1 - motion.gaugeFill.overlap);

  const litStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      fill.value,
      [start, start + motion.gaugeFill.overlap],
      [0, 1],
      Extrapolation.CLAMP,
    );

    return {
      opacity: progress,
      transform: [{ scaleY: TICK_REST_SCALE + (1 - TICK_REST_SCALE) * progress }],
    };
  });

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.tick}
    >
      {isLit ? (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: tone }, litStyle]}>
          <LinearGradient
            colors={gradients.meterGloss.colors}
            end={{ x: 0.5, y: 1 }}
            locations={gradients.meterGloss.locations}
            start={{ x: 0.5, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gauge: { flexDirection: 'row', alignItems: 'stretch', gap: 3, height: GAUGE_HEIGHT },
  // Ticks flex rather than carry a width, so the gauge fills whatever it is given and the
  // reading stays in the same relative place on every screen. Clipped, so the colour layer
  // inside takes the tick's rounding without repeating it.
  tick: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: TICK_RADIUS,
    // Not transparent: the empty part has to read as scale waiting to be filled, which is
    // what makes the lit part a proportion of something.
    backgroundColor: colors.border,
  },
});
