import { useEffect } from 'react';
import {
  Easing,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

/**
 * One clock for everything the eye toggle conceals.
 *
 * Shared rather than reimplemented per component so a balance, the tile logos beside it, the trend
 * arrow and the slash on the control itself all move on the same curve over the same 280ms. They did
 * not before: the figures swapped on the frame the boolean flipped, and anything that read the same
 * boolean flipped with them, so there was nothing to be out of step with. Once the numbers ease, every
 * element that does not becomes the thing the eye notices.
 *
 * Returned as a `SharedValue` so each caller writes its own `useAnimatedStyle` and the interpolation
 * stays on the UI thread. Several figures conceal at once on both balance headers, and a JS-driven
 * version would be competing for frames with the press feedback on the control that started it.
 *
 * Reduced motion snaps to the end state. There is no information in the transition — the figure is
 * either legible or masked — so removing it costs nothing.
 */
export function useConcealProgress(hidden: boolean): SharedValue<number> {
  const reduceMotion = useReducedMotion();
  const conceal = useSharedValue(hidden ? 1 : 0);

  useEffect(() => {
    const target = hidden ? 1 : 0;

    if (reduceMotion) {
      conceal.set(target);
      return;
    }

    conceal.set(
      withTiming(target, {
        duration: motion.conceal.duration,
        easing: Easing.inOut(Easing.cubic),
      }),
    );
  }, [conceal, hidden, reduceMotion]);

  return conceal;
}
