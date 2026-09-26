import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { layoutMorph } from '@/components/motion/layoutMorph';
import { motion } from '@/theme/tokens';

/**
 * A view whose frame springs to wherever layout puts it, on the app's one morph spring.
 *
 * `layoutMorph` animates only the view it is on; everything that can be moved by a change needs it too, or
 * the one that changed glides while its neighbours jump. Wrapping each moving part of a surface in this —
 * rather than hand-adding the prop and the reduce-motion check at each site — is what keeps them on the
 * same physics, arriving together.
 *
 * `fadeIn` and `fadeOut` are for a view that is mounted and unmounted rather than only moved, and they have
 * a real limit: a view fades in at its final place, and a removed view fades out where it last stood. Both
 * hold still while everything around them springs, so a view that comes and goes *among* moving neighbours
 * overlaps them on the way — use `Collapsible` for that, which stays mounted and folds with them. These are
 * for a view that is clipped by its own container, or that replaces another in the same place.
 *
 * No delay anywhere: every change begins on the frame it is asked for. Under reduce motion none of it runs.
 */
export function MorphView({
  children,
  fadeIn = false,
  fadeOut = false,
  style,
}: {
  readonly children: ReactNode;
  readonly fadeIn?: boolean;
  readonly fadeOut?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      {...(reduceMotion ? null : {
        layout: layoutMorph(),
        ...(fadeIn ? { entering: FadeIn.duration(motion.rowSwap.fadeMs) } : null),
        ...(fadeOut ? { exiting: FadeOut.duration(motion.rowSwap.fadeMs) } : null),
      })}
      style={style}
    >
      {children}
    </Animated.View>
  );
}
