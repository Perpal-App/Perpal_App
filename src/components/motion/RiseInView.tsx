import { useEffect } from 'react';
import type { ViewProps } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type BaseAnimationBuilder,
  type LayoutAnimationFunction,
} from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

type RiseInViewProps = ViewProps & {
  /** Reveal duration, in ms. */
  duration?: number;
  /**
   * Hold the layer hidden for this many ms before it rises, so it can be
   * sequenced after another animation. Ignored under reduce motion.
   */
  delay?: number;
  /** Distance in px the layer travels upward into place. */
  offsetY?: number;
  /**
   * Layout transition for the wrapper itself, for sections that get pushed up or down when a
   * neighbour changes size. Declared explicitly because `ViewProps` has no `layout`, so it would
   * otherwise be dropped by the spread below rather than reaching the animated view.
   *
   * Typed exactly as Reanimated types the prop. Pass `layoutMorph()` unless there is a reason not
   * to — every displaced box in a column has to share one spring or they arrive out of step.
   */
  layout?: BaseAnimationBuilder | LayoutAnimationFunction | typeof BaseAnimationBuilder;
};

/**
 * Slide-and-fade reveal: the layer eases up into its final position as it fades
 * in.
 *
 * Only `opacity` and `transform` are animated, both on the UI thread. The
 * element already occupies its final slot in the layout on the first frame, so
 * the travel is composited and never triggers a layout pass or shifts anything
 * around it.
 *
 * Under reduce motion the element is shown in place immediately and the delay is
 * skipped, so nothing waits on an animation that never plays.
 */
export function RiseInView({
  children,
  duration = motion.rise.duration,
  delay = 0,
  offsetY = motion.rise.offsetY,
  layout,
  style,
  ...rest
}: RiseInViewProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.set(1);
      return;
    }

    progress.set(0);
    progress.set(
      withDelay(
        delay,
        withTiming(1, { duration, easing: Easing.inOut(Easing.cubic) }),
      ),
    );
  }, [delay, duration, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * offsetY }],
  }));

  return (
    // The entrance is a transform and the layout transition is a frame change, so the two compose
    // instead of overwriting each other. The transition also cannot fire on the first frame —
    // there is no previous layout to travel from — so it never collides with the rise.
    // `layout` is spread conditionally rather than passed directly: under
    // `exactOptionalPropertyTypes` an optional prop will not accept an explicit `undefined`, so
    // forwarding it unconditionally would hand the animated view a value it has no type for.
    <Animated.View
      {...rest}
      {...(layout === undefined ? {} : { layout })}
      style={[style, animatedStyle]}
    >
      {children}
    </Animated.View>
  );
}
