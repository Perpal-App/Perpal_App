import type { TabTriggerSlotProps } from 'expo-router/ui';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { TabBarIcon } from '@/assets/svg/TabBarIcon';
import {
  HIGHLIGHT_EXPANDED,
  HIGHLIGHT_MINIMIZED,
  ICON_SIZE,
  ITEM_GAP,
  ITEM_PAD_V,
  LABEL_HEIGHT,
  SLIDE_SPRING,
  useBarContext,
  type GlassTabItem,
} from '@/navigation/tabs/barGeometry';
import { setMinimized, useMinimizeState } from '@/navigation/tabs/minimizeState';
import { colors, fonts, motion } from '@/theme/tokens';

/**
 * One tab trigger: an icon that crossfades between tints, over a label that fades and
 * is clipped away as the bar minimizes, both dipping toward the pill while pressed.
 */
export function GlassTabButton({
  index,
  isFocused,
  item,
  onPress,
  ...props
}: TabTriggerSlotProps & {
  readonly index: number;
  readonly item: GlassTabItem;
}) {
  const minimized = useMinimizeState();
  const progress = minimized.progress;
  const bar = useBarContext();
  const slideIndex = bar?.slideIndex;
  const pressedIndex = bar?.pressedIndex;
  // 0 = at rest, 1 = fully pressed.
  const pressed = useSharedValue(0);

  // A reaction rather than a `withSpring` read inline in the style: the press has to
  // spring between two states, and this keeps the animation started exactly once per
  // transition instead of on every frame the style is evaluated.
  useAnimatedReaction(
    () => pressedIndex !== undefined && pressedIndex.value === index,
    (isPressed, wasPressed) => {
      if (isPressed === wasPressed) return;
      pressed.set(withSpring(isPressed ? 1 : 0, motion.spring));
    },
  );

  // Covers navigation the bar did not initiate — deep links, back gestures, a
  // programmatic jump. While a finger is scrubbing it owns the highlight, so never
  // fight it with a spring.
  //
  // The `targetIndex` check is what keeps a tap smooth: focus arrives while the
  // spring the tap started is still travelling, and retargeting it to the point it is
  // already heading for restarts it from a standstill. Losing that velocity mid-flight
  // is the hitch, so a spring already aimed here is left alone.
  useEffect(() => {
    if (!isFocused || bar === null) return;
    if (bar.isDragging.value || bar.targetIndex.value === index) return;

    bar.targetIndex.set(index);
    bar.slideIndex.set(withSpring(index, SLIDE_SPRING));
  }, [bar, index, isFocused]);

  // Tint follows the highlight rather than navigation focus: whatever the pill sits
  // over lights up, live while scrubbing and travelling on a tap.
  const activeGlyphStyle = useAnimatedStyle(() => ({
    opacity: slideIndex === undefined
      ? (isFocused ? 1 : 0)
      : 1 - Math.min(Math.abs(slideIndex.value - index), 1),
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4], [1, 0], Extrapolation.CLAMP),
    color: slideIndex === undefined
      ? (isFocused ? colors.textPrimary : colors.textMuted)
      : interpolateColor(
        Math.min(Math.abs(slideIndex.value - index), 1),
        [0, 1],
        [colors.textPrimary, colors.textMuted],
      ),
  }));

  // Height is animated explicitly rather than derived from the children, so the icon
  // stays exactly centred on every frame: layout-driven sizing lags a frame behind a
  // UI-thread animation.
  const boxStyle = useAnimatedStyle(() => ({
    height: interpolate(
      progress.value,
      [0, 1],
      [HIGHLIGHT_EXPANDED, HIGHLIGHT_MINIMIZED],
      Extrapolation.CLAMP,
    ),
  }));

  // Press feedback: the icon and label dip toward the pill under the finger and spring
  // back on release. Kept on its own style so it only re-evaluates while a press is in
  // flight, and transform-only so it never disturbs the animated height above. The
  // highlight deliberately does not scale — the thing that moves is the thing touched.
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * (1 - motion.pressScale) }],
  }));

  return (
    <Pressable
      {...props}
      onPress={(event) => {
        // The gesture detector normally consumes touches; this path still runs for
        // assistive activation and hardware keyboards.
        bar?.targetIndex.set(index);
        bar?.slideIndex.set(withSpring(index, SLIDE_SPRING));
        setMinimized(minimized, 0);
        onPress?.(event);
      }}
      style={styles.trigger}
    >
      <Animated.View style={[styles.item, boxStyle, pressStyle]}>
        <View>
          <TabBarIcon color={colors.textMuted} name={item.icon} size={ICON_SIZE} />
          <Animated.View style={[StyleSheet.absoluteFill, styles.centre, activeGlyphStyle]}>
            <TabBarIcon color={colors.textPrimary} name={item.icon} size={ICON_SIZE} />
          </Animated.View>
        </View>
        <Animated.Text numberOfLines={1} style={[styles.label, labelStyle]}>
          {item.label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  item: {
    alignSelf: 'stretch',
    alignItems: 'center',
    overflow: 'hidden',
    paddingTop: ITEM_PAD_V,
  },
  centre: { alignItems: 'center', justifyContent: 'center' },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 9.5,
    lineHeight: LABEL_HEIGHT,
    marginTop: ITEM_GAP,
  },
});
