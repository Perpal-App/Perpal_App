import { useEffect, useRef, useState } from 'react';
import type { ViewProps } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

type PresenceViewProps = ViewProps & {
  /** Whether the content should be shown. Toggling this plays enter/exit. */
  visible: boolean;
  /** Enter/exit duration, in ms (used symmetrically for both directions). */
  duration?: number;
  /**
   * Scale the layer enters from and exits to. 1 keeps it a pure fade/slide;
   * a value below 1 grows it in, above 1 shrinks it in.
   */
  fromScale?: number;
  /** Distance in px the layer travels into place, composited with the scale. */
  offsetY?: number;
  /** Opacity the layer settles at while visible. */
  toOpacity?: number;
  /** Called once the exit animation has finished and the layer has unmounted. */
  onExited?: () => void;
};

/**
 * Animated presence wrapper: plays a composited enter when `visible` becomes
 * true and a reverse exit when it becomes false, keeping its children mounted
 * until the exit finishes. This gives content that is otherwise dropped by a
 * conditional render a smooth close instead of vanishing instantly.
 *
 * Only `opacity` and `transform` (scale + translateY) animate, both on the UI
 * thread via one shared value, so the motion is composited and never triggers a
 * layout pass or blocks the JS thread.
 *
 * Under reduce motion the layer appears and disappears immediately with no
 * animation, and `onExited` still fires so dependent state stays correct.
 */
export function PresenceView({
  children,
  visible,
  duration = motion.rise.duration,
  fromScale = 1,
  offsetY = 0,
  toOpacity = 1,
  onExited,
  style,
  ...rest
}: PresenceViewProps) {
  const reduceMotion = useReducedMotion();
  const [rendered, setRendered] = useState(visible);
  // Refs keep the exit guard and callback out of the effect's dependency list,
  // so an unrelated re-render never restarts the enter animation.
  const renderedRef = useRef(rendered);
  const onExitedRef = useRef(onExited);
  const progress = useSharedValue(visible ? 1 : 0);

  renderedRef.current = rendered;

  useEffect(() => {
    onExitedRef.current = onExited;
  }, [onExited]);

  useEffect(() => {
    if (visible) {
      setRendered(true);

      if (reduceMotion) {
        progress.set(1);
        return;
      }

      progress.set(
        withTiming(1, { duration, easing: Easing.out(Easing.cubic) }),
      );
      return;
    }

    // Already hidden (e.g. initial mount): nothing to animate out.
    if (!renderedRef.current) {
      return;
    }

    const finishExit = () => {
      setRendered(false);
      onExitedRef.current?.();
    };

    if (reduceMotion) {
      progress.set(0);
      finishExit();
      return;
    }

    progress.set(
      withTiming(
        0,
        { duration, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) {
            runOnJS(finishExit)();
          }
        },
      ),
    );
  }, [duration, progress, reduceMotion, visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value * toOpacity,
    transform: [
      { translateY: (1 - progress.value) * offsetY },
      { scale: fromScale + (1 - fromScale) * progress.value },
    ],
  }));

  if (!rendered) {
    return null;
  }

  return (
    <Animated.View {...rest} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
