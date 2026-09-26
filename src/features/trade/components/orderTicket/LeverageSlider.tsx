import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { TICKET_TONES, type TicketTone } from '@/features/trade/components/orderTicket/ticketTone';
import { colors, motion, radii, spacing, typography } from '@/theme/tokens';

const THUMB = 24;
const RAIL_HEIGHT = 4;
const RAIL_TOUCH = 44;
/** How much the thumb grows under a finger, so the grab is felt before anything moves. */
const HELD_GROWTH = 0.12;

// Settled against the sheet's scroll view: a horizontal intent claims the touch quickly, a vertical one
// fails it, so the body still scrolls when a swipe happens to start on the rail.
const PAN_ACTIVATE_X = 4;
const PAN_FAIL_Y = 12;
const TAP_MAX_DISTANCE = 12;
const TAP_MAX_DURATION = 600;

/**
 * An integer slider for leverage, from `min` to `max`.
 *
 * Controlled: the steppers beside the figure move it too, so the thumb has to follow a value it did not
 * set. A drag owns the thumb while it lasts — the finger is the source of truth then — and every other
 * change springs it to the step.
 *
 * The thumb tracks the finger continuously and snaps to a whole step on release, and each step crossed
 * fires one selection tick on iOS. That pairing is what makes a stepped slider feel like it has detents
 * without the thumb stuttering from one to the next.
 *
 * Only transform runs per frame, on the UI thread. The JS side hears about a step at most once per step.
 *
 * The filled track and the thumb's rim take the ticket's tone, like every other selection on it.
 */
export function LeverageSlider({
  max,
  min,
  onChange,
  tone,
  value,
}: {
  readonly max: number;
  readonly min: number;
  readonly onChange: (next: number) => void;
  readonly tone: TicketTone;
  readonly value: number;
}) {
  const ink = TICKET_TONES[tone];
  const reduceMotion = useReducedMotion();
  const span = Math.max(max - min, 1);
  const travel = useSharedValue(0);
  const progress = useSharedValue((value - min) / span);
  const dragging = useSharedValue(false);
  const reported = useSharedValue(value);
  const held = useSharedValue(0);

  const latest = useRef(onChange);
  useEffect(() => { latest.current = onChange; }, [onChange]);
  const dispatch = useCallback((next: number) => {
    if (Platform.OS === 'ios') void Haptics.selectionAsync();
    latest.current(next);
  }, []);

  // Follows a value set from outside. Skipped mid-drag, where the value arriving is the one the finger
  // just produced and the thumb is already there.
  useEffect(() => {
    reported.set(value);
    if (dragging.value) return;
    const target = (value - min) / span;
    progress.set(reduceMotion ? target : withSpring(target, motion.spring));
  }, [dragging, min, progress, reduceMotion, reported, span, value]);

  const gesture = useMemo(() => {
    const fractionAt = (x: number) => {
      'worklet';
      if (travel.value <= 0) return progress.value;
      return Math.min(Math.max((x - THUMB / 2) / travel.value, 0), 1);
    };
    const report = (fraction: number) => {
      'worklet';
      const step = Math.min(Math.max(Math.round(fraction * span) + min, min), max);
      if (step !== reported.value) {
        reported.set(step);
        runOnJS(dispatch)(step);
      }
      return step;
    };
    const settle = (step: number) => {
      'worklet';
      const target = (step - min) / span;
      progress.set(reduceMotion ? target : withSpring(target, motion.spring));
    };

    const pan = Gesture.Pan()
      .activeOffsetX([-PAN_ACTIVATE_X, PAN_ACTIVATE_X])
      .failOffsetY([-PAN_FAIL_Y, PAN_FAIL_Y])
      .onBegin(() => held.set(withSpring(1, motion.spring)))
      .onStart((event) => {
        dragging.set(true);
        progress.set(fractionAt(event.x));
        report(progress.value);
      })
      .onUpdate((event) => {
        progress.set(fractionAt(event.x));
        report(progress.value);
      })
      .onFinalize(() => {
        held.set(withSpring(0, motion.spring));
        if (!dragging.value) return;
        settle(reported.value);
        dragging.set(false);
      });

    const tap = Gesture.Tap()
      .maxDistance(TAP_MAX_DISTANCE)
      .maxDuration(TAP_MAX_DURATION)
      .onEnd((event, success) => {
        if (!success) return;
        settle(report(fractionAt(event.x)));
      });

    return Gesture.Race(pan, tap);
  }, [dispatch, dragging, held, max, min, progress, reduceMotion, reported, span, travel]);

  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(1 - progress.value) * travel.value }],
  }));
  // Centred on its track position by the transform itself, so the thumb needs no negative margin: it
  // starts half its width before the track, and the rail's own inset is what makes room for that.
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * travel.value - THUMB / 2 },
      { scale: 1 + held.value * HELD_GROWTH },
    ],
  }));

  return (
    <View style={styles.root}>
      <GestureDetector gesture={gesture}>
        <View
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          accessibilityLabel="Leverage"
          accessibilityRole="adjustable"
          accessibilityValue={{ max, min, now: value, text: `${value}×` }}
          onAccessibilityAction={(event) => {
            const next = value + (event.nativeEvent.actionName === 'increment' ? 1 : -1);
            if (next >= min && next <= max) onChange(next);
          }}
          style={styles.rail}
        >
          <View onLayout={(event) => travel.set(event.nativeEvent.layout.width)} style={styles.track}>
            <View style={styles.railBase}>
              <Animated.View style={[styles.railFill, { backgroundColor: ink.rim }, fillStyle]} />
            </View>
            <Animated.View style={[styles.thumb, { borderColor: ink.ink }, thumbStyle]} />
          </View>
        </View>
      </GestureDetector>
      {/* The range, under its own ends. Hidden from the screen reader, which already hears the bounds in
          the adjustable's value. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.bounds}>
        <Text style={styles.bound}>{`${min}×`}</Text>
        <Text style={styles.bound}>{`${max}×`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xxs },
  rail: { minHeight: RAIL_TOUCH, justifyContent: 'center', paddingHorizontal: THUMB / 2 },
  track: { height: THUMB, justifyContent: 'center' },
  railBase: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: RAIL_HEIGHT,
    borderRadius: radii.pill,
    overflow: 'hidden',
    backgroundColor: colors.borderStrong,
  },
  // Colours come from the tone, per render; these are the shapes.
  railFill: { position: 'absolute', inset: 0 },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: radii.pill,
    borderWidth: 2,
    backgroundColor: colors.surfaceElevated,
  },
  bounds: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xxs },
  bound: { ...typography.caption, color: colors.textMuted },
});
