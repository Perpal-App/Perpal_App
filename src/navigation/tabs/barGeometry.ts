import { createContext, useContext } from 'react';
import {
  Extrapolation,
  interpolate,
  type SharedValue,
} from 'react-native-reanimated';

import type { TabIconName } from '@/assets/svg/TabBarIcon';

export const EXPANDED_HEIGHT = 58;
export const MINIMIZED_HEIGHT = 44;
/** Extra horizontal inset applied to the pill when minimized, per side. */
export const MINIMIZED_INSET = 34;
/** Outer margin between the pill and the screen edges, per side. */
export const BAR_MARGIN = 12;
/** Inner inset between the capsule wall and the tab items. */
export const ROW_PAD_H = 4;
export const LABEL_HEIGHT = 13;
export const ICON_SIZE = 21;
/**
 * Gap between icon and label, folded into the label block's animated height so it
 * disappears completely when minimized and leaves the icon exactly centred.
 */
export const ITEM_GAP = 2;
const LABEL_BLOCK = LABEL_HEIGHT + ITEM_GAP;
export const ITEM_PAD_V = 7;
/** Highlight heights. Radius tracks half the height for a true capsule. */
export const HIGHLIGHT_EXPANDED = ICON_SIZE + LABEL_BLOCK + ITEM_PAD_V * 2;
export const HIGHLIGHT_MINIMIZED = ICON_SIZE + ITEM_PAD_V * 2;
/** Sentinel for "no finger down", so the pressed index can stay a plain number. */
export const NO_PRESS = -1;

/**
 * Slide spring, interruptible by design: rapid tab-hopping retargets with velocity
 * preserved. Slightly under-damped so the pill gives a small settle, which is safe
 * here because the slide is transform-only.
 */
export const SLIDE_SPRING = { duration: 420, dampingRatio: 0.82 } as const;

/**
 * Total vertical space the floating bar occupies at rest. Screens add this to their
 * bottom padding so their last row clears the pill instead of hiding under it — the
 * bar floats over content and cannot reserve the space itself.
 *
 * Screens that pin their own bottom bar do not need it: the tab bar steps aside for
 * those entirely, so reserving room would leave a gap where the pill used to be.
 */
export const TAB_BAR_CLEARANCE = EXPANDED_HEIGHT + BAR_MARGIN * 2;

/**
 * Capsule geometry, shared by the bar, the highlight and the scrub maths.
 *
 * Both carry the `worklet` directive and live at module scope: an animated style runs
 * on the UI runtime, and a plain function declared in a component body is a JS-thread
 * closure that the UI runtime cannot call — it throws "Tried to synchronously call a
 * Remote Function" the first frame it evaluates.
 */
export function barHeightAt(progress: number): number {
  'worklet';
  return interpolate(
    progress,
    [0, 1],
    [EXPANDED_HEIGHT, MINIMIZED_HEIGHT],
    Extrapolation.CLAMP,
  );
}

export function sideInsetAt(progress: number): number {
  'worklet';
  return interpolate(progress, [0, 1], [0, MINIMIZED_INSET], Extrapolation.CLAMP);
}

export type GlassTabItem = {
  readonly name: string;
  readonly label: string;
  readonly icon: TabIconName;
};

export type BarContextValue = {
  readonly slideIndex: SharedValue<number>;
  readonly isDragging: SharedValue<boolean>;
  /**
   * Index currently under a finger, or `NO_PRESS`. Press feedback has to come from
   * here rather than from each trigger's own `Pressable`: the bar's gesture detector
   * cancels the touches those press states are built on, so `onPressIn` never
   * arrives. The bar knows where the finger is, so it publishes it.
   */
  readonly pressedIndex: SharedValue<number>;
  /**
   * Where the highlight has been told to go, which is not the same as where focus
   * currently is: a tap moves the highlight on the gesture's frame and navigation
   * lands a few frames later. Triggers compare against this so the arriving focus
   * event does not restart a spring that is already on its way.
   */
  readonly targetIndex: SharedValue<number>;
};

export const BarContext = createContext<BarContextValue | null>(null);

/**
 * The bar's shared values, or null when a trigger is rendered outside a bar. Every
 * consumer has to cope with null rather than assume a provider, so a trigger used on
 * its own still renders instead of crashing.
 */
export function useBarContext(): BarContextValue | null {
  return useContext(BarContext);
}
