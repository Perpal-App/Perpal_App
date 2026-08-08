import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import {
  useAnimatedScrollHandler,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Spring, not timing: scroll direction flips mid-animation constantly, and a
 * spring retargets while preserving velocity — a timing curve would restart from
 * zero and feel mechanical. Critically damped (ratio 1) so there is no overshoot
 * and no long settling tail, which matters because the bar animates its own
 * height and inset rather than only a transform.
 */
export const MINIMIZE_SPRING = { duration: 380, dampingRatio: 1 } as const;

/** Scroll thresholds: dead zone near the top, and a few px of intent either way. */
const TOP_ZONE = 24;
const INTENT = 3;
/** Below this lift-off speed no momentum follows, so the scroll has ended. */
const REST_VELOCITY = 0.2;

export type MinimizeState = {
  /** 0 = expanded (icons and labels), 1 = minimized (icons only). */
  readonly progress: SharedValue<number>;
  /** Last requested target, so writers can avoid restarting the spring. */
  readonly target: SharedValue<number>;
};

const MinimizeContext = createContext<MinimizeState | null>(null);

export function TabBarMinimizeProvider({ children }: PropsWithChildren) {
  const progress = useSharedValue(0);
  const target = useSharedValue(0);
  const state = useMemo(() => ({ progress, target }), [progress, target]);

  return <MinimizeContext.Provider value={state}>{children}</MinimizeContext.Provider>;
}

/**
 * Full minimize state, used by the bar and by the scroll handler.
 *
 * Falls back to a local value when there is no provider above, so a screen that
 * renders outside the tab shell — an auth route, a pushed detail screen — still
 * works without a floating bar listening.
 */
export function useMinimizeState(): MinimizeState {
  const shared = useContext(MinimizeContext);
  const progress = useSharedValue(0);
  const target = useSharedValue(0);
  const local = useMemo(() => ({ progress, target }), [progress, target]);

  return shared ?? local;
}

/** The animated 0..1 progress that styles interpolate on. */
export function useTabBarMinimized(): SharedValue<number> {
  return useMinimizeState().progress;
}

/**
 * Retargets the minimize spring. A no-op when already heading to `next`, so the
 * per-frame scroll handler below cannot restart — and visibly stutter — the
 * animation. Callable from either thread.
 */
export function setMinimized(state: MinimizeState, next: 0 | 1): void {
  'worklet';
  if (state.target.value !== next) {
    state.target.set(next);
    state.progress.set(withSpring(next, MINIMIZE_SPRING));
  }
}

/**
 * Scroll handler for an animated scroller. Scrolling down minimizes the bar,
 * scrolling up or sitting near the top expands it.
 *
 * Offsets are clamped to the scrollable range so rubber-band overscroll cannot
 * invert the direction for a frame and flicker the bar.
 */
export function useMinimizeOnScroll() {
  const state = useMinimizeState();
  const previousY = useSharedValue(0);

  return useAnimatedScrollHandler({
    onScroll: (event) => {
      const maxY = Math.max(event.contentSize.height - event.layoutMeasurement.height, 0);
      const y = Math.min(Math.max(event.contentOffset.y, 0), maxY);
      const dy = y - previousY.value;
      previousY.set(y);

      if (y < TOP_ZONE) setMinimized(state, 0);
      else if (dy > INTENT) setMinimized(state, 1);
      else if (dy < -INTENT) setMinimized(state, 0);
    },
    // The bar is minimized only while the page is actually moving. Both handlers
    // are needed to cover the ways a scroll ends: a fling settles at momentum end,
    // while a slow drag released with no speed left never starts momentum at all.
    // Expanding on lift-off regardless would fight the fling that follows it.
    onEndDrag: (event) => {
      if (Math.abs(event.velocity?.y ?? 0) < REST_VELOCITY) setMinimized(state, 0);
    },
    onMomentumEnd: () => {
      setMinimized(state, 0);
    },
  });
}
