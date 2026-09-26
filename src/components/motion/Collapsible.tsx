import { useEffect, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { MorphView } from '@/components/motion/MorphView';
import { motion } from '@/theme/tokens';

/**
 * A section that folds away where it stands instead of being unmounted.
 *
 * Mounting and unmounting cannot move with a layout that is springing around them: a view fades in at its
 * final place and a removed view fades out where it last stood, and either way it holds still while its
 * neighbours travel — so it sits across them for the length of the spring. This stays mounted and folds its
 * height to nothing on the same morph spring as everything else, so it is always exactly the size of the
 * gap its neighbours are closing or opening, and nothing ever crosses it. Its content is clipped to the
 * folding frame and fades on the way.
 *
 * `spaceAfter` replaces the column's `gap` for this section. A gap belongs to the column rather than to the
 * section, so a folded section would still claim one; spacing carried inside the fold goes with it.
 *
 * Folded, it is hidden from assistive tech and takes no touches. Under reduce motion it folds and unfolds at
 * once.
 */
export function Collapsible({
  children,
  collapsed,
  grow = false,
  spaceAfter = 0,
}: {
  readonly children: ReactNode;
  readonly collapsed: boolean;
  /** Takes the column's spare height while open. */
  readonly grow?: boolean;
  readonly spaceAfter?: number;
}) {
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(collapsed ? 0 : 1);

  useEffect(() => {
    const target = collapsed ? 0 : 1;
    shown.set(reduceMotion ? target : withTiming(target, { duration: motion.rowSwap.fadeMs }));
  }, [collapsed, reduceMotion, shown]);

  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));

  return (
    <MorphView style={[styles.clip, grow && !collapsed && styles.grow, collapsed && styles.folded]}>
      <Animated.View
        accessibilityElementsHidden={collapsed}
        importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
        pointerEvents={collapsed ? 'none' : 'auto'}
        style={[grow && styles.grow, { paddingBottom: spaceAfter }, fade]}
      >
        {children}
      </Animated.View>
    </MorphView>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  grow: { flexGrow: 1 },
  folded: { height: 0 },
});
