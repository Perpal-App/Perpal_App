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

type FadeInViewProps = ViewProps & {
  /** Cross-fade duration, in ms. */
  duration?: number;
  /**
   * Hold the layer hidden for this many ms before fading, so it can be
   * sequenced after another animation. Ignored under reduce motion.
   */
  delay?: number;
  /**
   * Opacity the layer settles at. Set this instead of a static `opacity` in the
   * style, which the animated opacity would override.
   */
  toOpacity?: number;
};

/**
 * Cross-fade reveal. Opacity is the only animated property and it runs on the
 * UI thread. It starts immediately unless a `delay` is given.
 *
 * When the OS reduce-motion setting is on, the element is shown immediately and
 * any delay is skipped, so nothing is left waiting on an animation that never
 * plays.
 */
export function FadeInView({
  children,
  duration = motion.fade.duration,
  delay = 0,
  toOpacity = 1,
  style,
  ...rest
}: FadeInViewProps) {
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
        withTiming(1, { duration, easing: Easing.out(Easing.quad) }),
      ),
    );
  }, [delay, duration, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value * toOpacity,
  }));

  return (
    <Animated.View {...rest} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
