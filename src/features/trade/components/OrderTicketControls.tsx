import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { colors, motion, radii, spacing, typography } from '@/theme/tokens';

/** Collateral shortcuts, as fractions of what the account can spend. */
const PRESETS = [25, 50, 75, 100] as const;

/** Step the screen reader's increment and decrement actions move the slider. */
const ADJUST_STEP = 25;

/**
 * Diameter of the slider's handle. The rail reserves half of it at each end so the handle
 * at 0% and at 100% is drawn inside the panel instead of being clipped by its edge, which
 * is what used to happen to it at rest.
 */
const THUMB = 18;

/** Height of the slider's touch area. The visible bar is 3pt; a finger needs this. */
const RAIL_TOUCH = 40;

/**
 * Gesture tolerances.
 *
 * The pan waits for horizontal intent because this rail sits inside a vertically
 * scrolling screen: a drag that starts on the handle but travels down the page belongs to
 * the scroll view, and a slider that swallows it makes the screen feel stuck. Past
 * `PAN_ACTIVATE_X` the finger has committed sideways and the pan takes the touch.
 */
const PAN_ACTIVATE_X = 4;
const PAN_FAIL_Y = 12;
const TAP_MAX_DISTANCE = 12;
const TAP_MAX_DURATION = 600;

/**
 * The order ticket's controls.
 *
 * They live apart from the ticket because the ticket is a state machine — quote, plan,
 * signature, submission — and these are the surfaces it drives. Each one is sized for the
 * half-width column the ticket occupies beside the order book: single-line labels, a
 * caption-scale figure row, and nothing that assumes it has the whole screen.
 */
export function Choice(props: {
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly selected: boolean;
  readonly tone?: 'long' | 'short';
}) {
  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected, disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[
        styles.choice,
        props.selected && styles.choiceSelected,
        props.tone === 'long' && props.selected && styles.longSelected,
        props.tone === 'short' && props.selected && styles.shortSelected,
        props.disabled && styles.disabled,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.choiceLabel,
          props.tone === 'long' && props.selected && styles.longLabel,
          props.tone === 'short' && props.selected && styles.shortLabel,
        ]}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

/**
 * A number and the unit it is in.
 *
 * `align` decides where the number sits, and it is a legibility choice rather than a
 * cosmetic one. A field holding an amount with a word for a unit — `Collateral … USDC` —
 * reads left to right like the label it is. A bare multiplier does not: left-aligned, the
 * `3` sat at one end of the box and the `×` at the other, far enough apart that the unit
 * read as a stray character dropped into the corner instead of as part of the value.
 * Right-aligned they touch, and `3×` reads as one figure.
 */
export function Field(props: {
  readonly accessibilityLabel: string;
  readonly align?: 'left' | 'right';
  /**
   * Standing text at the head of the field, for a value that has no placeholder to name it.
   *
   * A leverage box holding `3×` and nothing else reads as an unfinished control — there is
   * no empty state in which it could tell you what it is, because it always holds a number.
   */
  readonly label?: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  readonly suffix: string;
  readonly value: string;
}) {
  const tight = props.align === 'right';

  return (
    <View style={styles.field}>
      {props.label === undefined ? null : (
        <Text numberOfLines={1} style={styles.fieldLabel}>{props.label}</Text>
      )}
      <TextInput
        accessibilityLabel={props.accessibilityLabel}
        inputMode="decimal"
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textMuted}
        // Still the full width of the field either way: the whole box has to stay tappable,
        // or a control this size becomes a target only a stylus could hit.
        style={[styles.input, tight && styles.inputRight]}
        value={props.value}
      />
      <Text style={[styles.suffix, tight && styles.suffixTight]}>{props.suffix}</Text>
    </View>
  );
}

export function Toggle(props: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onChange: (value: boolean) => void;
  readonly value: boolean;
}) {
  return (
    <View style={[styles.toggleRow, props.disabled && styles.disabled]}>
      <Switch
        accessibilityLabel={props.label}
        disabled={props.disabled}
        onValueChange={props.onChange}
        thumbColor={props.value ? colors.accentSoft : colors.textMuted}
        trackColor={{ false: colors.borderStrong, true: colors.accent }}
        value={props.value}
      />
      <Text numberOfLines={1} style={styles.toggleLabel}>{props.label}</Text>
    </View>
  );
}

/**
 * How much of the available balance to commit, as a handle you can drag.
 *
 * The handle follows the finger on the UI thread — one shared value drives the fill and
 * the handle's `translateX`, and nothing about the motion waits on React. It used to be a
 * `Pressable` that read `locationX` on release, so the only way to reach 40% was to guess
 * where 40% was and tap it; the handle never moved under the finger at all.
 *
 * JavaScript hears from it once per whole percent instead of once per frame. That is what
 * the collateral field needs, and it keeps `parseAmount` and the balance arithmetic off the
 * path the drag is drawn on: if the JS thread stalls, the handle keeps tracking and only
 * the figure lags.
 *
 * The position is the slider's own, not a prop mirrored back from the ticket. The percent
 * buttons beside it are a separate way to reach the same number, and dragging one control
 * to a value the other happens to offer does not make them one control: tapping 50% no
 * longer throws the handle across the rail, and parking the handle on 50% no longer lights
 * that button up. `resetSignal` is the one thing that moves the handle from outside, for
 * the cases where the slider's claim is void — a new market, a new session, or a collateral
 * amount typed in by hand.
 */
export function CollateralSlider({
  onChange,
  resetSignal,
}: {
  readonly onChange: (next: number) => void;
  readonly resetSignal: number;
}) {
  const reduceMotion = useReducedMotion();
  // Travel available to the handle's centre: the rail's width less the half-handle
  // reserved at each end, measured from the track itself rather than assumed.
  const travel = useSharedValue(0);
  const progress = useSharedValue(0);
  const dragging = useSharedValue(false);
  const reported = useSharedValue(0);
  const held = useSharedValue(0);
  const [percent, setPercent] = useState(0);

  // The ticket rebuilds its handler on every render, and a drag renders it once per whole
  // percent. Routing through a ref keeps the gesture itself built once, so a live drag is
  // never reconfigured underneath the finger that is driving it.
  const latest = useRef(onChange);
  useEffect(() => { latest.current = onChange; }, [onChange]);
  const dispatch = useCallback((next: number) => {
    setPercent(next);
    latest.current(next);
  }, []);

  const settleAt = useCallback((next: number) => {
    const clamped = Math.min(Math.max(Math.round(next), 0), 100);
    reported.set(clamped);
    setPercent(clamped);
    progress.set(reduceMotion ? clamped / 100 : withSpring(clamped / 100, motion.spring));
    return clamped;
  }, [progress, reduceMotion, reported]);

  // Return to rest, and only that. Guarded on the current value because a typed collateral
  // amount signals on every keystroke, and a spring restarted at its own resting point on
  // each character is work nobody can see.
  useEffect(() => {
    if (reported.value === 0 || dragging.value) return;
    settleAt(0);
  }, [dragging, reported, resetSignal, settleAt]);

  const gesture = useMemo(() => {
    const fractionAt = (x: number) => {
      'worklet';
      if (travel.value <= 0) return progress.value;
      return Math.min(Math.max((x - THUMB / 2) / travel.value, 0), 1);
    };
    const report = (fraction: number) => {
      'worklet';
      const rounded = Math.round(fraction * 100);
      if (rounded !== reported.value) {
        reported.set(rounded);
        runOnJS(dispatch)(rounded);
      }
      return rounded;
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
        // Also fires when the pan never activated because the touch was a tap, which the
        // tap gesture owns. Only settle a drag that actually ran.
        if (!dragging.value) return;
        // Land on the whole percent that was reported, so the handle and the figure beside
        // it agree once the finger leaves.
        const settled = reported.value / 100;
        progress.set(reduceMotion ? settled : withSpring(settled, motion.spring));
        dragging.set(false);
      });

    // Tapping the rail still jumps to that point, which is how the control worked before
    // and is faster than dragging when the target is a long way off.
    const tap = Gesture.Tap()
      .maxDistance(TAP_MAX_DISTANCE)
      .maxDuration(TAP_MAX_DURATION)
      .onEnd((event, success) => {
        if (!success) return;
        const landed = report(fractionAt(event.x)) / 100;
        progress.set(reduceMotion ? landed : withSpring(landed, motion.spring));
      });

    return Gesture.Race(pan, tap);
  }, [dispatch, dragging, held, progress, reduceMotion, reported, travel]);

  // Composited: the fill is a full-width bar sliding inside a clip, so its length changes
  // without a layout pass, and the handle only ever translates and scales.
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -(1 - progress.value) * travel.value }],
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * travel.value },
      { scale: 1 + held.value * (1 - motion.pressScale) },
    ],
  }));

  return (
    <View style={styles.sliderRow}>
      <GestureDetector gesture={gesture}>
        <View
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          accessibilityLabel="Collateral percentage"
          accessibilityRole="adjustable"
          accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent}%` }}
          onAccessibilityAction={(event) => onChange(settleAt(
            percent + (event.nativeEvent.actionName === 'increment' ? ADJUST_STEP : -ADJUST_STEP),
          ))}
          style={styles.rail}
        >
          <View
            onLayout={(event) => travel.set(event.nativeEvent.layout.width)}
            style={styles.trackRow}
          >
            <View style={styles.railBase}>
              <Animated.View style={[styles.railFill, fillStyle]} />
            </View>
            <Animated.View style={[styles.thumb, thumbStyle]} />
          </View>
        </View>
      </GestureDetector>
      <View style={styles.percentValue}>
        <Text numberOfLines={1} style={styles.percentLabel}>{`${percent}%`}</Text>
      </View>
    </View>
  );
}

/**
 * Fixed fractions of the available balance, one tap each.
 *
 * `selected` is the button that was last tapped, not whatever the collateral currently
 * works out to. The slider is a separate control and its position does not choose a button
 * here — a handle resting on half the rail is not the same statement as having asked for
 * half — so `null` is the normal state once anything else has set the amount.
 */
export function PercentPresets({
  onSelect,
  selected,
}: {
  readonly onSelect: (value: number) => void;
  readonly selected: number | null;
}) {
  return (
    <View style={styles.presets}>
      {PRESETS.map((value) => (
        <Pressable
          accessibilityLabel={`${value}% of available collateral`}
          accessibilityRole="button"
          accessibilityState={{ selected: value === selected }}
          key={value}
          onPress={() => onSelect(value)}
          style={[styles.preset, value === selected && styles.presetSelected]}
        >
          <Text numberOfLines={1} style={styles.presetLabel}>{`${value}%`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * A label and a figure on one line, at caption scale.
 *
 * The ticket's own row rather than the shared `StatusRow` because that row is built for a
 * full-width screen: at body scale with a 16pt gutter, `Liquidation price` and a
 * six-figure price do not fit in half a phone together, and the value wrapped onto a
 * second line mid-number. Here the label is abbreviated to what a ticket can say in one
 * word and spells itself out to a screen reader instead.
 */
export function TicketRow({
  label,
  screenReaderLabel,
  value,
}: {
  readonly label: string;
  readonly screenReaderLabel?: string;
  readonly value: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${screenReaderLabel ?? label}: ${value}`}
      style={styles.ticketRow}
    >
      <Text numberOfLines={1} style={styles.ticketLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.ticketValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  choice: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxs,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated },
  longSelected: { borderColor: colors.positive },
  shortSelected: { borderColor: colors.negative },
  choiceLabel: { ...typography.bodyCompact, color: colors.textPrimary },
  longLabel: { color: colors.positive },
  shortLabel: { color: colors.negative },
  field: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    paddingHorizontal: spacing.xs,
    color: colors.textPrimary,
    ...typography.bodyCompact,
  },
  fieldLabel: { ...typography.caption, flexShrink: 0, paddingLeft: spacing.xs, color: colors.textMuted },
  inputRight: { paddingRight: 2, textAlign: 'right' },
  suffix: { ...typography.caption, paddingRight: spacing.xs, color: colors.textMuted },
  // Same size as the value it belongs to, so `3×` reads as one figure rather than a number
  // with a smaller mark parked next to it.
  suffixTight: { ...typography.bodyCompact, color: colors.textSecondary },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // The touch area, which is deliberately much bigger than the bar it draws. The
  // half-handle of horizontal padding is what keeps the handle inside the panel at both
  // ends, and it also makes the track's own width the exact travel of the handle's centre.
  rail: {
    flex: 1,
    minWidth: 0,
    minHeight: RAIL_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: THUMB / 2,
  },
  trackRow: { height: THUMB, justifyContent: 'center' },
  railBase: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    borderRadius: radii.pill,
    overflow: 'hidden',
    backgroundColor: colors.borderStrong,
  },
  railFill: {
    position: 'absolute',
    inset: 0,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.accentSoft,
    backgroundColor: colors.surfaceElevated,
  },
  percentValue: {
    width: 48,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
  },
  percentLabel: { ...typography.caption, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  presets: { flexDirection: 'row', gap: spacing.xxs },
  preset: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
  },
  presetSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated },
  presetLabel: { ...typography.caption, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  toggleRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  toggleLabel: { ...typography.bodyCompact, flexShrink: 1, color: colors.textSecondary },
  ticketRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  ticketLabel: { ...typography.caption, flexShrink: 0, color: colors.textMuted },
  ticketValue: {
    ...typography.caption,
    flexShrink: 1,
    color: colors.textPrimary,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  disabled: { opacity: 0.45 },
});
