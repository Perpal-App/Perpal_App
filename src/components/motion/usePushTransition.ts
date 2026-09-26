import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

/**
 * A page pushed over another and popped back off it, the way a navigation stack moves them.
 *
 * `pageStyle` is for the page on top, which must be opaque: it slides in from past the trailing edge of the
 * screen. `behindStyle` is for the page it covers, which is carried a share of the way the other way and
 * dims out as it goes, so the two pages' contents never sit on top of each other and nothing of the page
 * behind is left showing in the margins once the push lands.
 *
 * `mounted` stays true until a pop has finished, so the page keeps drawing what it showed while it leaves;
 * render the page only while it is set. Both directions run one spring from wherever the last one got to,
 * so Back pressed mid-push reverses the page with its momentum.
 *
 * Transform and opacity only, on the UI thread. The travel is the window's width, used as a transform
 * distance and never as a layout dimension. Under reduce motion the page appears and disappears in place
 * and the page behind does not move.
 */
export function usePushTransition(pushed: boolean) {
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const [mounted, setMounted] = useState(pushed);
  const progress = useSharedValue(pushed ? 1 : 0);
  const wanted = useRef(pushed);

  // State adjusted during render: mounted on the render that pushes, so the page's first frame is already
  // past the edge, and gone at once under reduce motion, which has no pop to wait for.
  if (pushed && !mounted) setMounted(true);
  if (!pushed && mounted && reduceMotion) setMounted(false);

  // A pop that finishes after a push has started again must not take the page down with it.
  const finishPop = useCallback(() => {
    if (!wanted.current) setMounted(false);
  }, []);

  useEffect(() => {
    wanted.current = pushed;
    const target = pushed ? 1 : 0;
    if (reduceMotion) {
      progress.set(target);
      return;
    }
    progress.set(withSpring(target, motion.push.spring, (finished) => {
      'worklet';
      if (finished === true && target === 0) runOnJS(finishPop)();
    }));
  }, [finishPop, progress, pushed, reduceMotion]);

  const parallax = width * motion.push.parallax;

  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: reduceMotion ? 0 : (1 - progress.value) * width }],
  }));

  const behindStyle = useAnimatedStyle(() => {
    // Clamped: a critically damped spring should not overshoot, but opacity has to stay in range if it does.
    const shown = reduceMotion ? 0 : Math.min(Math.max(progress.value, 0), 1);
    return {
      opacity: 1 - shown,
      transform: [{ translateX: -shown * parallax }],
    };
  });

  return { behindStyle, mounted, pageStyle };
}

export type PushTransition = ReturnType<typeof usePushTransition>;
