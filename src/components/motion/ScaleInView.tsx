import { useEffect } from 'react';
import type { ViewProps } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

type ScaleInViewProps = ViewProps & {
  /** Reveal duration, in ms. */
  duration?: number;
  /**
   * Hold the layer hidden for this many ms before it settles, so it can be
   * sequenced after another animation. Ignored under reduce motion.
   */
  delay?: number;
  /**
   * Scale the layer starts at before settling to its resting size (1). A value
   * above 1 reads as a larger hero on the previous screen shrinking into place;
   * a value below 1 reads as growing in.
   */
  fromScale?: number;
  /** Distance in px the layer also travels into place, composited with the scale. */
  offsetY?: number;
};

/**
 * Scale-and-fade reveal for "shared element"-style entrances.
 *
 * As a native stack screen pushes in, the layer settles from `fromScale` to its
 * resting size while fading (and optionally rising) into place, so an element
 * can read as arriving from a larger hero on the previous screen without the
 * experimental native shared-element API.
 *
 * Only `opacity` and `transform` (scale + translateY) are animated, both on the
 * UI thread. The element keeps its final layout slot on the first frame, so the
 * motion is composited and never triggers a layout pass or shifts neighbours —
 * it cannot block the JS thread or stall the incoming transition.
 *
 * Under reduce motion the element is shown in place immediately and the delay is
 * skipped, so nothing waits on an animation that never plays.
 */
export function ScaleInView({
  children,
  duration = motion.rise.duration,
  delay = 0,
  fromScale = 1.12,
  offsetY = 0,
  style,
  ...rest
}: ScaleInViewProps) {
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
        withTiming(1, { duration, easing: Easing.out(Easing.cubic) }),
      ),
    );
  }, [delay, duration, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * offsetY },
      { scale: fromScale + (1 - fromScale) * progress.value },
    ],
  }));

  return (
    <Animated.View {...rest} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
