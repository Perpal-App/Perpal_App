import type { TabsDescriptor, TabsSlotRenderOptions } from 'expo-router/ui';
import { useEffect, type PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Screen } from 'react-native-screens';

import { motion } from '@/theme/tokens';

/** Signed distance from the arriving screen's start scale to its resting size. */
const SETTLE = motion.tabSwitch.scale - 1;

/**
 * Ease-out, matching every other reveal in the app: most of the travel lands in the
 * first third, so the switch reads as immediate and the tail is just the settle
 * finishing.
 */
const ENTER = { duration: motion.tabSwitch.duration, easing: Easing.out(Easing.cubic) };

/**
 * `TabSlot` render override that gives tab switches the shared-element feel of the
 * onboarding handoff instead of a horizontal push.
 *
 * The arriving screen settles from just over its resting size, the same scale
 * `ScaleInView` plays on the auth screen's brand mark, so a tab switch and the
 * onboarding handoff share one motion. Nothing translates: directional travel is what
 * makes a switch feel like a stack push, and tabs are siblings with no hierarchy to
 * move through.
 *
 * Two things this transition deliberately never does, both for the same reason — the
 * tab pill is translucent and samples whatever sits beneath it, so anything that
 * changes the surface under the bar reads as a flash in the bar rather than as motion
 * on the screen. It never animates opacity, because a screen fading up from zero is a
 * stretch of frames where its content is partly absent. And it never scales below 1,
 * because a screen smaller than its container exposes a band of bare shell along the
 * bottom edge, which is exactly where the pill is looking.
 *
 * Only the arriving screen animates, and it could not be otherwise: expo-router
 * hardcodes `hasTwoStates` on its `ScreenContainer`, which on iOS resolves to
 * `RNSScreenNavigationContainerView`, whose `updateContainer` sets the container's
 * view controllers to a single screen. The outgoing screen leaves the hierarchy in
 * the same commit that reveals the new one.
 *
 * Mirrors expo-router's `defaultTabsSlotRender` for the lazy and unmount rules so
 * screens keep the loading semantics they were configured with.
 */
export function renderTabScreen(
  descriptor: TabsDescriptor,
  { isFocused, loaded, detachInactiveScreens }: TabsSlotRenderOptions,
) {
  const { lazy = true, unmountOnBlur, freezeOnBlur } = descriptor.options;

  if (unmountOnBlur === true && !isFocused) {
    return null;
  }

  // Never navigated to: leave it unmounted rather than paying for a screen the user
  // has not asked for.
  if (lazy && !loaded && !isFocused) {
    return null;
  }

  return (
    <TabScreenTransition
      detachInactiveScreens={detachInactiveScreens}
      freezeOnBlur={freezeOnBlur}
      isFocused={isFocused}
      key={descriptor.route.key}
    >
      {descriptor.render()}
    </TabScreenTransition>
  );
}

type TabScreenTransitionProps = PropsWithChildren<{
  readonly detachInactiveScreens: boolean;
  readonly freezeOnBlur: boolean | undefined;
  readonly isFocused: boolean;
}>;

/**
 * One tab screen and its entrance.
 *
 * Holds no state, so a switch costs nothing beyond the shared value the UI thread is
 * already reading. A transform is the only animated property, which keeps the motion
 * composited and immune to whatever the arriving screen is doing on the JS thread.
 *
 * Starting the animation from an effect is deliberate. A screen's first visit has to
 * mount and lay out before it can be shown, and all of that happens inside the
 * commit — before the effect runs and before anything is painted. So the previous
 * screen stays up for the duration of that work and the fade begins after it: the
 * hitch lands on a still frame instead of halfway through the motion.
 */
function TabScreenTransition({
  children,
  detachInactiveScreens,
  freezeOnBlur,
  isFocused,
}: TabScreenTransitionProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      progress.set(1);
      return;
    }

    if (isFocused) {
      progress.set(withTiming(1, ENTER));
      return;
    }

    // Rewound on blur rather than on the next focus: the screen is already hidden
    // here, so the reset is invisible. Doing it at focus time would mean writing the
    // start scale into the same commit that reveals the screen and racing the first
    // frame against it.
    progress.set(0);
  }, [isFocused, progress, reduceMotion]);

  // One transform, fully opaque, always at least covering its container: at no point
  // in the switch is the surface behind the glass pill anything but the destination.
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (1 - progress.value) * SETTLE }],
  }));

  return (
    <Screen
      activityState={isFocused ? 2 : 0}
      enabled={detachInactiveScreens}
      freezeOnBlur={freezeOnBlur}
      style={[styles.screen, isFocused ? styles.focused : styles.unfocused]}
    >
      <Animated.View style={[styles.fill, animatedStyle]}>{children}</Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, position: 'relative', height: '100%' },
  focused: { zIndex: 1, display: 'flex', flexShrink: 0, flexGrow: 1 },
  unfocused: { zIndex: -1, display: 'none', flexShrink: 1, flexGrow: 0 },
  fill: { flex: 1 },
});
