import { LinearTransition } from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

/**
 * The app's layout transition: a spring-driven morph for boxes that change size, and for
 * everything that has to move out of their way.
 *
 * Pass it to the `layout` prop of any animated view whose frame can change:
 *   `<Animated.View layout={layoutMorph()}>`
 *
 * Two rules make this work, and both are easy to get wrong.
 *
 * Reanimated's `layout` animates the frame of the view it is on and nothing else. A view further
 * down the column is placed at its final position on the frame after the change, so animating only
 * the box that resized leaves every one of its siblings snapping into place around it. Whichever
 * views can be displaced all need this, not just the one whose content changed.
 *
 * And they all need the *same* physics, which is why this is a function rather than a value each
 * caller assembles. Two sections springing at different rates arrive at different moments, and the
 * column visibly comes apart while it settles.
 *
 * A fresh builder per call, deliberately. Reanimated's builders are mutable config objects, and
 * handing the same instance to several views invites one view's chained modifier to leak into
 * another's. Building one is cheap; the result is a worklet either way.
 */
export function layoutMorph() {
  return LinearTransition
    .springify()
    .damping(motion.layoutMorph.damping)
    .stiffness(motion.layoutMorph.stiffness)
    .mass(motion.layoutMorph.mass);
}
