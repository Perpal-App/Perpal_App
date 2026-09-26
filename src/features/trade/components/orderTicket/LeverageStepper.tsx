import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, gradients, motion, radii, spacing, typography } from '@/theme/tokens';

const STEP_SIZE = 48;
const STEP_GLYPH = 20;
/** The figure's acknowledgement of a change: a few percent up and back, never a bounce. */
const VALUE_POP = 0.06;
const VALUE_POP_MS = 70;
/** The figure scales with the reader's text size, but not so far it crowds the steppers out. */
const FIGURE_TEXT_SCALE = 1.2;

/**
 * The leverage figure between a minus and a plus.
 *
 * Integers only, `1` to `max`: that is what the order builder accepts, and a figure shown as `10.0×`
 * would promise a precision the venue does not take. A step that would leave the range is not offered —
 * its button is disabled rather than silently doing nothing.
 */
export function LeverageStepper({
  max,
  onChange,
  value,
}: {
  readonly max: number;
  readonly onChange: (next: number) => void;
  readonly value: number;
}) {
  const step = (delta: number) => {
    const next = Math.min(Math.max(value + delta, 1), max);
    if (next === value) return;
    if (Platform.OS === 'ios') void Haptics.selectionAsync();
    onChange(next);
  };

  return (
    <View style={styles.stepper}>
      <StepButton disabled={value <= 1} glyph="remove" label="Decrease leverage" onPress={() => step(-1)} />
      <LeverageFigure value={value} />
      <StepButton disabled={value >= max} glyph="add" label="Increase leverage" onPress={() => step(1)} />
    </View>
  );
}

/**
 * The figure, with a small pop whenever it changes.
 *
 * The pop is the acknowledgement that a step landed — the number itself changing is easy to miss mid-drag,
 * when the eye is on the thumb. Scale only, on the UI thread, and not on the first frame, so the page
 * arrives still. Under reduce motion the number simply changes.
 */
function LeverageFigure({ value }: { readonly value: number }) {
  const reduceMotion = useReducedMotion();
  const pop = useSharedValue(0);
  const settled = useRef(false);

  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    if (reduceMotion) return;
    pop.set(withSequence(withTiming(1, { duration: VALUE_POP_MS }), withSpring(0, motion.spring)));
  }, [pop, reduceMotion, value]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pop.value * VALUE_POP }] }));

  return (
    <Animated.View
      accessibilityLabel={`${value}× leverage`}
      accessibilityLiveRegion="polite"
      accessible
      style={[styles.figure, popStyle]}
    >
      <Text maxFontSizeMultiplier={FIGURE_TEXT_SCALE} style={styles.figureValue}>{value}</Text>
      <Text maxFontSizeMultiplier={FIGURE_TEXT_SCALE} style={styles.figureUnit}>×</Text>
    </Animated.View>
  );
}

/** A round control in the app's raised material, the same object as the market header's back button. */
function StepButton({
  disabled,
  glyph,
  label,
  onPress,
}: {
  readonly disabled: boolean;
  readonly glyph: 'add' | 'remove';
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.step, disabled && styles.stepDisabled]}
    >
      <LinearGradient
        colors={gradients.surfaceRaise.colors}
        end={{ x: 0.5, y: 1 }}
        locations={gradients.surfaceRaise.locations}
        start={{ x: 0.5, y: 0 }}
        style={styles.stepFill}
      >
        <Ionicons color={colors.textPrimary} name={glyph} size={STEP_GLYPH} />
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  step: {
    width: STEP_SIZE,
    height: STEP_SIZE,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.pill,
  },
  stepFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stepDisabled: { opacity: 0.4 },
  // `flex: 1` holds the steppers at the edges whatever width the number takes, so `9×` to `10×` never
  // moves the controls either side of it.
  figure: { flex: 1, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 2 },
  figureValue: { ...typography.display, color: colors.textPrimary },
  figureUnit: { ...typography.title, color: colors.textMuted },
});
