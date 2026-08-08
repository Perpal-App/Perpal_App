import type { TabTriggerSlotProps } from 'expo-router/ui';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { TabBarIcon } from '@/assets/svg/TabBarIcon';
import {
  BAR_MARGIN,
  EXPANDED_HEIGHT,
  HIGHLIGHT_EXPANDED,
  HIGHLIGHT_MINIMIZED,
  ICON_SIZE,
  ITEM_GAP,
  ITEM_PAD_V,
  LABEL_HEIGHT,
  SLIDE_SPRING,
  barHeightAt,
  sideInsetAt,
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
  const { width: windowWidth } = useWindowDimensions();
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

  // Selection follows the highlight rather than navigation focus: whatever the pill sits
  // over lights up, live while scrubbing and travelling on a tap.
  //
  // One value drives both the solid glyph and the bold label, because they are two halves
  // of the same statement and reading one settle behind the other would look like a
  // rendering fault. Neither a glyph's weight nor a font family can be interpolated, so
  // each is a second layer crossfading over the resting one.
  const selectedStyle = useAnimatedStyle(() => ({
    opacity: slideIndex === undefined
      ? (isFocused ? 1 : 0)
      : 1 - Math.min(Math.abs(slideIndex.value - index), 1),
  }));

  // Only the labels fold away as the bar minimizes; the icons stay.
  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.4], [1, 0], Extrapolation.CLAMP),
  }));

  // The parent surface scales to the original minimized dimensions. Counter-scaling
  // keeps glyph and text sizes unchanged, while the vertical shift reproduces the
  // original icon centring after the label folds away. No layout is invalidated.
  const itemStyle = useAnimatedStyle(() => {
    const fullWidth = Math.max(windowWidth - BAR_MARGIN * 2, 1);
    const visualWidth = Math.max(
      fullWidth - sideInsetAt(progress.value) * 2,
      1,
    );
    const barScaleX = visualWidth / fullWidth;
    const barScaleY = barHeightAt(progress.value) / EXPANDED_HEIGHT;

    return {
      transform: [
        {
          translateY:
            progress.value * (HIGHLIGHT_EXPANDED - HIGHLIGHT_MINIMIZED) / 2,
        },
        { scaleX: 1 / barScaleX },
        { scaleY: 1 / barScaleY },
        { scale: 1 - pressed.value * (1 - motion.pressScale) },
      ],
    };
  });

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
      <Animated.View style={[styles.item, itemStyle]}>
        <View>
          <TabBarIcon color={colors.textMuted} name={item.icon} size={ICON_SIZE} />
          <Animated.View style={[StyleSheet.absoluteFill, styles.centre, selectedStyle]}>
            <TabBarIcon color={colors.glassSelected} filled name={item.icon} size={ICON_SIZE} />
          </Animated.View>
        </View>
        <Animated.View style={[styles.labelBox, labelStyle]}>
          <Text numberOfLines={1} style={styles.label}>{item.label}</Text>
          {/* The bold label is wider than the medium one, so it is centred over it rather
              than laid out beside it — otherwise selecting a tab would nudge its own
              label sideways. */}
          <Animated.View style={[StyleSheet.absoluteFill, styles.centre, selectedStyle]}>
            <Text numberOfLines={1} style={styles.selectedLabel}>{item.label}</Text>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  item: {
    height: HIGHLIGHT_EXPANDED,
    alignSelf: 'stretch',
    alignItems: 'center',
    overflow: 'hidden',
    paddingTop: ITEM_PAD_V,
  },
  centre: { alignItems: 'center', justifyContent: 'center' },
  labelBox: {
    alignSelf: 'stretch',
    height: LABEL_HEIGHT,
    marginTop: ITEM_GAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 9.5,
    lineHeight: LABEL_HEIGHT,
    color: colors.textMuted,
  },
  // Same metrics, heavier face: the box is a fixed height and both layers are centred in
  // it, so the swap changes weight without moving the baseline.
  //
  // `glassSelected`, not `accent`. The saturated violet is darker than the muted grey it
  // would replace, so selecting a tab would dim its own label; selection has to gain
  // brightness, so the tint comes from the bright end of the ramp.
  selectedLabel: {
    fontFamily: fonts.bold,
    fontSize: 9.5,
    lineHeight: LABEL_HEIGHT,
    color: colors.glassSelected,
  },
});
