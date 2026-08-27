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

const PRESETS = [25, 50, 75, 100] as const;
const ADJUST_STEP = 25;
const THUMB = 18;
const RAIL_TOUCH = 40;

const PAN_ACTIVATE_X = 4;
const PAN_FAIL_Y = 12;
const TAP_MAX_DISTANCE = 12;
const TAP_MAX_DURATION = 600;

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

export function Field(props: {
  readonly accessibilityLabel: string;
  readonly align?: 'left' | 'right' | 'center';
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  readonly suffix: string;
  readonly value: string;
}) {
  const input = useRef<TextInput>(null);
  const centred = props.align === 'center';
  const tight = centred || props.align === 'right';

  return (
    <Pressable
      accessible={false}
      onPress={() => input.current?.focus()}
      style={[styles.field, centred && styles.fieldCentred]}
    >
      <TextInput
        accessibilityLabel={props.accessibilityLabel}
        inputMode="decimal"
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={colors.textMuted}
        ref={input}
        style={[styles.input, tight && styles.inputRight, centred && styles.inputCentred]}
        value={props.value}
      />
      <Text style={[styles.suffix, tight && styles.suffixTight, centred && styles.suffixCentred]}>
        {props.suffix}
      </Text>
    </Pressable>
  );
}

export function StaticControl({
  accessibilityLabel,
  label,
}: {
  readonly accessibilityLabel?: string;
  readonly label: string;
}) {
  return (
    <View accessible accessibilityLabel={accessibilityLabel ?? label} style={styles.staticControl}>
      <Text numberOfLines={1} style={styles.staticLabel}>{label}</Text>
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

export function CollateralSlider({
  onChange,
  resetSignal,
}: {
  readonly onChange: (next: number) => void;
  readonly resetSignal: number;
}) {
  const reduceMotion = useReducedMotion();
  const travel = useSharedValue(0);
  const progress = useSharedValue(0);
  const dragging = useSharedValue(false);
  const reported = useSharedValue(0);
  const held = useSharedValue(0);
  const [percent, setPercent] = useState(0);

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
        if (!dragging.value) return;
        const settled = reported.value / 100;
        progress.set(reduceMotion ? settled : withSpring(settled, motion.spring));
        dragging.set(false);
      });

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
  fieldCentred: { justifyContent: 'center' },
  staticControl: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  staticLabel: { ...typography.bodyCompact, color: colors.textSecondary },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    paddingHorizontal: spacing.xs,
    color: colors.textPrimary,
    ...typography.bodyCompact,
  },
  inputRight: { paddingRight: 2, textAlign: 'right' },
  inputCentred: { flexGrow: 0, flexBasis: 'auto', minWidth: 24, paddingHorizontal: 0 },
  suffix: { ...typography.caption, paddingRight: spacing.xs, color: colors.textMuted },
  suffixTight: { ...typography.bodyCompact, color: colors.textSecondary },
  suffixCentred: { paddingRight: 0, paddingLeft: 1 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
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
