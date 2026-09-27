import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { RaisedMaterial } from '@/components/ui/RaisedMaterial';
import { colors, interfaceType, motion, radii, spacing } from '@/theme/tokens';

const TRACK_HEIGHT = 40;
/** The gap between the track's edge and the thumb, all round. */
const INSET = 3;
/** The thumb's corner, and the track's one ring out from it, so the two curves run parallel. */
const THUMB_RADIUS = radii.sm;
const TRACK_RADIUS = THUMB_RADIUS + INSET;
/** How far a drag has to travel sideways before it is a drag, and vertically before it is a scroll. */
const DRAG_START = 6;
const SCROLL_FAIL = 10;
/** Seconds of a release's velocity a flick carries forward, which is what lets it skip past a segment. */
const FLICK_CARRY = 0.08;
/** A segment under the finger that is not the chosen one dims to this, as UIKit's do. */
const PRESSED_DIM = 0.5;

export type SegmentOption<Id extends string> = {
  /** A count beside the label, shown only above zero: open positions, unread items. */
  readonly count?: number;
  readonly id: Id;
  readonly label: string;
};

/**
 * Two or more views of one thing, one chosen, with a thumb that slides between them.
 *
 * Built to feel like UIKit's segmented control. The thumb is one raised pill that travels between the
 * segments on a spring — it does not switch off in one place and on in another — and each label takes the
 * chosen colour by how much of the thumb is over it, so the colour moves across with it. A finger on the
 * chosen segment squeezes the thumb; a finger on another dims that label until it lifts. The thumb can be
 * dragged, and a flick carries it on; it settles on the nearest segment and chooses it when the finger
 * lifts. Each change gives one selection tick on iOS.
 *
 * Transform and opacity only, on the UI thread. The segments are equal widths, so where the thumb goes is a
 * translation of the segment index: nothing is measured per segment and nothing is laid out again while it
 * moves. Under reduce motion the thumb and the colours change in place.
 */
export function SegmentedControl<Id extends string>({
  accessibilityLabel,
  onSelect,
  options,
  selected,
}: {
  readonly accessibilityLabel: string;
  readonly onSelect: (id: Id) => void;
  readonly options: readonly SegmentOption<Id>[];
  readonly selected: Id;
}) {
  const reduceMotion = useReducedMotion();
  const index = Math.max(options.findIndex((option) => option.id === selected), 0);
  const last = options.length - 1;
  const [segmentWidth, setSegmentWidth] = useState(0);
  const segment = useSharedValue(0);
  /** Where the thumb is, in segments: 0 over the first, 1 over the second, anything between on the way. */
  const position = useSharedValue(index);
  const squeeze = useSharedValue(0);
  const pressed = useSharedValue(-1);
  const dragFrom = useSharedValue(0);
  /** A choice made by dragging, whose thumb is already on its way there and must not be sent again. */
  const settledByDrag = useRef<number | null>(null);

  useEffect(() => {
    if (settledByDrag.current === index) {
      settledByDrag.current = null;
      return;
    }
    settledByDrag.current = null;
    position.set(reduceMotion ? index : withSpring(index, motion.segment.slide));
  }, [index, position, reduceMotion]);

  const squeezeTo = useCallback((to: 0 | 1) => {
    squeeze.set(reduceMotion ? 0 : withSpring(to, motion.segment.press));
  }, [reduceMotion, squeeze]);

  const choose = useCallback((next: number) => {
    const option = options[next];
    if (option === undefined || option.id === selected) return;
    if (Platform.OS === 'ios') void Haptics.selectionAsync();
    onSelect(option.id);
  }, [onSelect, options, selected]);

  const chooseFromDrag = useCallback((next: number) => {
    if (next !== index) settledByDrag.current = next;
    choose(next);
  }, [choose, index]);

  const drag = useMemo(() => Gesture.Pan()
    .activeOffsetX([-DRAG_START, DRAG_START])
    .failOffsetY([-SCROLL_FAIL, SCROLL_FAIL])
    .onStart(() => {
      dragFrom.set(position.value);
      pressed.set(-1);
      squeeze.set(reduceMotion ? 0 : withSpring(1, motion.segment.press));
    })
    .onUpdate((event) => {
      if (segment.value <= 0) return;
      position.set(Math.min(Math.max(dragFrom.value + event.translationX / segment.value, 0), last));
    })
    .onEnd((event) => {
      const carried = segment.value <= 0
        ? position.value
        : position.value + (event.velocityX * FLICK_CARRY) / segment.value;
      const target = Math.min(Math.max(Math.round(carried), 0), last);
      position.set(reduceMotion ? target : withSpring(target, motion.segment.slide));
      runOnJS(chooseFromDrag)(target);
    })
    .onFinalize(() => {
      squeeze.set(reduceMotion ? 0 : withSpring(0, motion.segment.press));
    }), [chooseFromDrag, dragFrom, last, position, pressed, reduceMotion, segment, squeeze]);

  const onLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width / Math.max(options.length, 1);
    setSegmentWidth(width);
    segment.set(width);
  };

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: position.value * segment.value },
      { scale: 1 - (1 - motion.segment.squeeze) * squeeze.value },
    ],
  }));

  return (
    <GestureDetector gesture={drag}>
      <View accessibilityLabel={accessibilityLabel} accessibilityRole="tablist" onLayout={onLayout} style={styles.track}>
        {segmentWidth > 0 ? (
          <Animated.View pointerEvents="none" style={[styles.thumb, { width: segmentWidth - INSET * 2 }, thumbStyle]}>
            <RaisedMaterial sheen={0.45} />
          </Animated.View>
        ) : null}
        {options.map((option, at) => (
          <Pressable
            accessibilityLabel={option.count === undefined || option.count === 0
              ? option.label
              : `${option.label}, ${option.count}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: at === index }}
            key={option.id}
            onPress={() => choose(at)}
            onPressIn={() => {
              if (at === index) squeezeTo(1);
              else pressed.set(at);
            }}
            onPressOut={() => {
              squeezeTo(0);
              pressed.set(-1);
            }}
            style={styles.segment}
          >
            <SegmentLabel index={at} option={option} position={position} pressed={pressed} />
          </Pressable>
        ))}
      </View>
    </GestureDetector>
  );
}

/**
 * A segment's label, set twice — chosen, and quiet — with the chosen copy showing as much as the thumb is
 * over this segment. A crossfade by opacity, so the colour and the weight move without a colour animation
 * and without the text being laid out again. The chosen copy is the heavier one, so it is the one in the
 * flow and the lighter copy is laid over it: the box is always wide enough for either.
 */
function SegmentLabel<Id extends string>({
  index,
  option,
  position,
  pressed,
}: {
  readonly index: number;
  readonly option: SegmentOption<Id>;
  readonly position: SharedValue<number>;
  readonly pressed: SharedValue<number>;
}) {
  const chosenStyle = useAnimatedStyle(() => ({ opacity: nearness(position.value, index) }));
  const quietStyle = useAnimatedStyle(() => ({
    opacity: (1 - nearness(position.value, index)) * (pressed.value === index ? PRESSED_DIM : 1),
  }));
  const counted = option.count !== undefined && option.count > 0;

  return (
    <View>
      <Animated.View style={[styles.label, chosenStyle]}>
        <Text numberOfLines={1} style={styles.chosenText}>{option.label}</Text>
        {counted ? <Count chosen value={option.count ?? 0} /> : null}
      </Animated.View>
      <Animated.View style={[styles.label, styles.overlay, quietStyle]}>
        <Text numberOfLines={1} style={styles.quietText}>{option.label}</Text>
        {counted ? <Count chosen={false} value={option.count ?? 0} /> : null}
      </Animated.View>
    </View>
  );
}

function Count({ chosen, value }: { readonly chosen: boolean; readonly value: number }) {
  return (
    <View style={[styles.count, chosen && styles.countChosen]}>
      <Text style={[styles.countText, chosen && styles.countTextChosen]}>{value}</Text>
    </View>
  );
}

/** How much of the thumb is over segment `index`: 1 on it, 0 a segment or more away. */
function nearness(position: number, index: number): number {
  'worklet';
  return Math.min(Math.max(1 - Math.abs(position - index), 0), 1);
}

const styles = StyleSheet.create({
  // A recessed track: a step off the page, rimmed, and the thumb is the one raised thing in it.
  track: {
    height: TRACK_HEIGHT,
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: TRACK_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
  thumb: {
    position: 'absolute',
    top: INSET,
    bottom: INSET,
    left: INSET,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: THUMB_RADIUS,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceElevated,
  },
  segment: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  label: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xxs },
  // Exactly over the chosen copy: same box, so the two never drift apart as they cross.
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  quietText: { ...interfaceType.control, fontWeight: '500', color: colors.textMuted },
  chosenText: { ...interfaceType.control, color: colors.textPrimary },
  count: {
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  countChosen: { backgroundColor: colors.accent },
  countText: { ...interfaceType.badge, fontSize: 11, lineHeight: 14, color: colors.textMuted },
  countTextChosen: { color: colors.onAccent },
});
