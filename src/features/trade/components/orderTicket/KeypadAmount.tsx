import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOut,
  LayoutAnimationConfig,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { layoutMorph } from '@/components/motion/layoutMorph';
import { entryGlyphs } from '@/features/trade/components/orderTicket/keypadEntry';
import { colors, interfaceType, motion } from '@/theme/tokens';

/**
 * The two sizes the figure is set in, both with tabular figures, so every digit is the same width and one
 * being typed or deleted never nudges the others. Each glyph carries the role's full line height, so the
 * row is one line tall whatever it holds — an empty figure and a long one occupy the same height.
 */
const FACES = {
  hero: interfaceType.amount,
  field: interfaceType.amountField,
} as const;

/**
 * A keypad entry drawn as a figure, one animated character at a time.
 *
 * Each character is its own view with its own identity (`entryGlyphs` chooses the keys), so a typed digit
 * rises into its slot, a deleted one fades where it stood, and a thousands separator slides to its new
 * place instead of the whole number being redrawn. The characters that did not change do not move.
 *
 * A long figure shrinks to fit rather than wrapping or clipping, by a scale transform sprung toward
 * `box / content`. A transform, not a smaller font, so nothing around the figure is re-laid out as it
 * shrinks — the card keeps its height, the rows under it keep their places.
 *
 * `rejectSignal` shakes it: the owner increments it when a key could not apply. Under reduce motion the
 * figure simply changes — no rise, no slide, no shake — and it still fits.
 */
export function KeypadAmount({
  accessibilityLabel,
  entry,
  prefix = '$',
  rejectSignal,
  size,
}: {
  readonly accessibilityLabel: string;
  readonly entry: string;
  readonly prefix?: string;
  readonly rejectSignal: number;
  readonly size: keyof typeof FACES;
}) {
  const reduceMotion = useReducedMotion();
  const glyphs = useMemo(
    () => (entry.length === 0 ? [{ char: '0', key: 'placeholder' }] : entryGlyphs(entry)),
    [entry],
  );
  const empty = entry.length === 0;
  const face = FACES[size];

  const scale = useSharedValue(1);
  const contentWidth = useSharedValue(0);
  const shake = useSharedValue(0);
  const widths = useRef({ box: 0, content: 0 });

  const refit = useCallback(() => {
    const { box, content } = widths.current;
    const next = box > 0 && content > box ? box / content : 1;
    scale.set(reduceMotion ? next : withSpring(next, motion.spring));
  }, [reduceMotion, scale]);

  const onBoxLayout = useCallback((event: LayoutChangeEvent) => {
    widths.current.box = event.nativeEvent.layout.width;
    refit();
  }, [refit]);

  const onContentLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    widths.current.content = width;
    contentWidth.set(width);
    refit();
  }, [contentWidth, refit]);

  useEffect(() => {
    if (rejectSignal === 0 || reduceMotion) return;
    const { stepMs, travel } = motion.reject;
    shake.set(withSequence(
      withTiming(-travel, { duration: stepMs }),
      withTiming(travel, { duration: stepMs }),
      withTiming(-travel / 2, { duration: stepMs }),
      withTiming(travel / 3, { duration: stepMs }),
      withTiming(0, { duration: stepMs }),
    ));
  }, [reduceMotion, rejectSignal, shake]);

  // Scaled about the row's centre, then moved back by the width that took off its left edge — which pins
  // the figure to the left without depending on `transformOrigin`. The shake rides the same translation.
  const rowStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: shake.value - ((1 - scale.value) * contentWidth.value) / 2 },
      { scale: scale.value },
    ],
  }));

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessible
      onLayout={onBoxLayout}
      style={styles.box}
    >
      {/* Entering is skipped for what is already there when the figure mounts, and exiting for what is
          still there when it unmounts, so opening or closing a page does not replay every digit. */}
      <LayoutAnimationConfig skipEntering skipExiting>
        <Animated.View onLayout={onContentLayout} style={[styles.row, rowStyle]}>
          <Text style={[face, styles.ink, empty && styles.muted]}>{prefix}</Text>
          {glyphs.map((glyph) => (
            <Animated.View
              key={glyph.key}
              {...(reduceMotion ? null : { entering: digitEnter(), exiting: digitExit(), layout: layoutMorph() })}
            >
              <Text style={[face, styles.ink, empty && styles.muted]}>{glyph.char}</Text>
            </Animated.View>
          ))}
        </Animated.View>
      </LayoutAnimationConfig>
    </View>
  );
}

/** Rises into place on the app's press spring, which carries one soft overshoot as it seats. */
function digitEnter() {
  return FadeInDown
    .withInitialValues({ opacity: 0, transform: [{ translateY: motion.keypad.digitTravel }] })
    .springify()
    .damping(motion.spring.damping)
    .stiffness(motion.spring.stiffness)
    .mass(motion.spring.mass);
}

function digitExit() {
  return FadeOut.duration(motion.keypad.digitExitMs);
}

const styles = StyleSheet.create({
  // Clips the figure while it is wider than the space and the fit is still catching up, and clips a
  // rising digit to the line it is rising into. `flex-start` lets the row take its natural width, which
  // is what the fit measures.
  box: { flex: 1, minWidth: 0, overflow: 'hidden', alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center' },
  ink: { color: colors.textPrimary },
  muted: { color: colors.textMuted },
});
