import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import type { TabListProps } from 'expo-router/ui';
import { Children, useCallback, useEffect, useMemo, type RefObject } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProgressiveBlur } from '@/navigation/tabs/ProgressiveBlur';
import {
  BAR_MARGIN,
  BarContext,
  EXPANDED_HEIGHT,
  HIGHLIGHT_EXPANDED,
  HIGHLIGHT_MINIMIZED,
  NO_PRESS,
  ROW_PAD_H,
  SLIDE_SPRING,
  barHeightAt,
  sideInsetAt,
} from '@/navigation/tabs/barGeometry';
import { setMinimized, useMinimizeState } from '@/navigation/tabs/minimizeState';
import { colors } from '@/theme/tokens';

export { TAB_BAR_CLEARANCE, type GlassTabItem } from '@/navigation/tabs/barGeometry';

/** How far the bottom progressive blur bleeds above the pill. */
const BLUR_BLEED = 44;
/** Gesture tolerances: past this much horizontal travel the pan takes over. */
const PAN_ACTIVATE_X = 6;
const PAN_FAIL_Y = 14;
const TAP_MAX_DISTANCE = 16;
const TAP_MAX_DURATION = 400;

/**
 * Dismissal spring. Critically damped: the bar is getting out of the way of another
 * control, so it should leave decisively and not bounce back toward it.
 */
const DISMISS_SPRING = { duration: 320, dampingRatio: 1 } as const;

/**
 * Floating glass tab bar: a capsule that minimizes as the page scrolls, with a
 * sliding highlight and finger scrubbing.
 *
 * Three rules hold the interaction together. The highlight tracks the finger 1:1 while
 * dragging — no spring, because a spring makes it feel unattached. It never navigates
 * mid-drag, only on release, because switching screens under a moving finger makes the
 * content jump. And every geometry value is derived from shared values rather than from
 * layout callbacks, so the pill, the highlight and the labels all move on the same
 * frame.
 *
 * Glass is built from stacked blur rather than a native liquid-glass view, so it
 * renders the same on both platforms; the capsule falls back to a solid surface where
 * blur is unavailable.
 */
export function GlassTabBar({
  blurTarget,
  children,
  dismissed = false,
  onIndexSelected,
  haptics = true,
  ...props
}: TabListProps & {
  /**
   * The screen container to blur behind the capsule. Required rather than optional:
   * Android silently renders no blur without a target, and a bar that quietly loses
   * its glass on one platform is worse than a compile error.
   */
  readonly blurTarget: RefObject<View | null>;
  /**
   * Slide the whole bar off the bottom edge and stop it taking touches. For screens
   * that pin a control of their own down there — the bar cannot simply overlap one,
   * because the capsule samples what is behind it and would both bury the control and
   * pick up its colour.
   */
  readonly dismissed?: boolean;
  readonly onIndexSelected?: (index: number) => void;
  readonly haptics?: boolean;
}) {
  // The one place in the app besides AppScreen that reads an inset. A bar that floats
  // over every screen sits inside no screen, so it has nothing else to take its
  // home-indicator clearance from, and hardcoding that number is exactly what the
  // layout contract forbids.
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const minimized = useMinimizeState();
  const progress = minimized.progress;
  const slideIndex = useSharedValue(0);
  const isDragging = useSharedValue(false);
  const targetIndex = useSharedValue(0);
  const pressedIndex = useSharedValue(NO_PRESS);
  const lastTicked = useSharedValue(-1);
  const dismissal = useSharedValue(dismissed ? 1 : 0);
  const tabCount = Math.max(Children.count(children), 1);
  const bottomOffset = Math.max(insets.bottom - 16, BAR_MARGIN);
  const expandedItemWidth = Math.max(
    (windowWidth - BAR_MARGIN * 2 - ROW_PAD_H * 2) / tabCount,
    1,
  );

  const tick = useCallback(() => {
    if (haptics && Platform.OS === 'ios') void Haptics.selectionAsync();
  }, [haptics]);
  const selectIndex = useCallback(
    (index: number) => onIndexSelected?.(index),
    [onIndexSelected],
  );

  useEffect(() => {
    dismissal.set(withSpring(dismissed ? 1 : 0, DISMISS_SPRING));
  }, [dismissal, dismissed]);

  const gesture = useMemo(() => {
    const indexAtX = (x: number) => {
      'worklet';
      const barWidth = windowWidth - BAR_MARGIN * 2;
      const itemWidth = (barWidth - ROW_PAD_H * 2) / tabCount;
      const raw = (x - ROW_PAD_H) / itemWidth - 0.5;
      return Math.min(Math.max(raw, 0), tabCount - 1);
    };

    const pan = Gesture.Pan()
      .activeOffsetX([-PAN_ACTIVATE_X, PAN_ACTIVATE_X])
      .failOffsetY([-PAN_FAIL_Y, PAN_FAIL_Y])
      .onStart(() => {
        isDragging.set(true);
        lastTicked.set(Math.round(slideIndex.value));
        // Scrubbing is a deliberate interaction with the bar, so surface the labels.
        setMinimized(minimized, 0);
      })
      .onUpdate((event) => {
        const index = indexAtX(event.x);
        slideIndex.set(index);
        const rounded = Math.round(index);
        if (rounded !== lastTicked.value) {
          lastTicked.set(rounded);
          runOnJS(tick)();
        }
      })
      .onFinalize(() => {
        // Also fires when the pan failed because the touch was a tap. Only act if the
        // pan actually activated, or this would stomp the tap's navigation.
        if (!isDragging.value) return;
        const rounded = Math.round(slideIndex.value);
        targetIndex.set(rounded);
        slideIndex.set(withSpring(rounded, SLIDE_SPRING));
        runOnJS(selectIndex)(rounded);
        isDragging.set(false);
      });

    const tap = Gesture.Tap()
      // Real fingers drift a few points, and the default tolerance is tight enough
      // that ordinary taps fail. Past the pan's activation distance it wins anyway.
      .maxDistance(TAP_MAX_DISTANCE)
      .maxDuration(TAP_MAX_DURATION)
      // Touch-down, before the tap is known to succeed. Press feedback has to lead the
      // decision, not follow it — waiting for the tap to be recognised would put the
      // response a whole gesture behind the finger.
      .onBegin((event) => {
        pressedIndex.set(Math.round(indexAtX(event.x)));
      })
      .onEnd((event, success) => {
        if (!success) return;
        const index = Math.round(indexAtX(event.x));
        // Claim the target before navigating, so the focus effect that fires a few
        // frames later recognises this spring as its own and leaves it running.
        targetIndex.set(index);
        slideIndex.set(withSpring(index, SLIDE_SPRING));
        setMinimized(minimized, 0);
        // Navigation first. Both of these queue onto the JS thread, and the screen
        // swap is the one the user is waiting for — putting the haptic ahead of it
        // makes the switch wait on a native call it has nothing to do with.
        runOnJS(selectIndex)(index);
        runOnJS(tick)();
      })
      // Covers every ending: recognised, failed, or cancelled because the pan took
      // over. The press state cannot be left latched on any of those paths.
      .onFinalize(() => {
        pressedIndex.set(NO_PRESS);
      });

    return Gesture.Race(pan, tap);
  }, [
    isDragging,
    lastTicked,
    minimized,
    pressedIndex,
    progress,
    selectIndex,
    slideIndex,
    tabCount,
    targetIndex,
    tick,
    windowWidth,
  ]);

  // Everything the bar draws leaves together, scrim included: a dark gradient left
  // behind over someone else's buttons is worse than the pill itself. Translating by
  // the full resting height clears the screen edge, and the fade covers the blur
  // bleed that reaches above it.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: 1 - dismissal.value,
    transform: [{ translateY: dismissal.value * (bottomOffset + EXPANDED_HEIGHT) }],
  }));

  // Keep the native blur at one fixed layout size and composite the same final
  // geometry with transforms. Resizing the Android blur every animation frame was
  // forcing a full list re-layout and blur pass while Markets was scrolling.
  const barStyle = useAnimatedStyle(() => {
    const fullWidth = Math.max(windowWidth - BAR_MARGIN * 2, 1);
    const visualWidth = Math.max(
      fullWidth - sideInsetAt(progress.value) * 2,
      1,
    );

    return {
      transform: [
        { scaleX: visualWidth / fullWidth },
        { scaleY: barHeightAt(progress.value) / EXPANDED_HEIGHT },
      ],
    };
  });

  // One shared highlight that slides between tabs, transform-only so it stays on the
  // GPU. All of its geometry comes from shared values.
  const highlightStyle = useAnimatedStyle(() => {
    const bar = barHeightAt(progress.value);
    const height = interpolate(
      progress.value,
      [0, 1],
      [HIGHLIGHT_EXPANDED, HIGHLIGHT_MINIMIZED],
      Extrapolation.CLAMP,
    );
    const barScaleY = bar / EXPANDED_HEIGHT;

    return {
      transform: [
        { translateX: ROW_PAD_H + expandedItemWidth * slideIndex.value },
        { scaleY: height / (HIGHLIGHT_EXPANDED * barScaleY) },
      ],
    };
  });

  const barContext = useMemo(
    () => ({ slideIndex, isDragging, targetIndex, pressedIndex }),
    [slideIndex, isDragging, targetIndex, pressedIndex],
  );

  return (
    <Animated.View
      {...props}
      // Driven by the prop rather than the animation, so the screen's own controls
      // become reachable the moment the bar starts leaving instead of when it lands.
      // Hidden from assistive tech on the same frame, for the same reason.
      accessibilityElementsHidden={dismissed}
      importantForAccessibility={dismissed ? 'no-hide-descendants' : 'auto'}
      pointerEvents={dismissed ? 'none' : 'box-none'}
      style={[styles.root, chromeStyle]}
    >
      <ProgressiveBlur
        direction="bottom"
        style={[styles.blur, { height: bottomOffset + EXPANDED_HEIGHT + BLUR_BLEED }]}
      />

      <View
        pointerEvents="box-none"
        style={{ marginHorizontal: BAR_MARGIN, marginBottom: bottomOffset }}
      >
        <GestureDetector gesture={gesture}>
          <Animated.View
            renderToHardwareTextureAndroid
            style={[styles.bar, barStyle]}
          >
            <AnimatedBlurView
              // Android blurs a target view rather than whatever happens to be behind
              // it, so the layout hands us the screen container to sample. Without a
              // target this method silently falls back to no blur, which is why the
              // tint below has to stand on its own.
              blurMethod="dimezisBlurViewSdk31Plus"
              blurTarget={blurTarget}
              intensity={28}
              style={[StyleSheet.absoluteFill, styles.capsule]}
              tint="systemThickMaterialDark"
            />
            <Animated.View
              style={[styles.highlight, { width: expandedItemWidth }, highlightStyle]}
            />
            <View style={styles.row}>
              <BarContext.Provider value={barContext}>{children}</BarContext.Provider>
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  blur: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: { height: EXPANDED_HEIGHT },
  capsule: {
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderRadius: EXPANDED_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassRim,
    backgroundColor: colors.glassTint,
  },
  highlight: {
    position: 'absolute',
    left: 0,
    top: (EXPANDED_HEIGHT - HIGHLIGHT_EXPANDED) / 2,
    height: HIGHLIGHT_EXPANDED,
    borderRadius: HIGHLIGHT_EXPANDED / 2,
    borderCurve: 'continuous',
    backgroundColor: colors.glassHighlight,
  },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: ROW_PAD_H },
});
