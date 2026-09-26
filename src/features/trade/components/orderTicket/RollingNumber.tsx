import { StyleSheet, Text, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  LayoutAnimationConfig,
  useReducedMotion,
  withTiming,
} from 'react-native-reanimated';

import { layoutMorph } from '@/components/motion/layoutMorph';
import { motion } from '@/theme/tokens';

const { inMs: IN_MS, outMs: OUT_MS, travelShare: TRAVEL_SHARE } = motion.digitRoll;
const IN_EASING = Easing.out(Easing.cubic);

/**
 * A whole number that changes digit by digit: only the digits that change move, and the ones that stay hold
 * still — the way a phone animates a figure it is counting.
 *
 * Each digit is keyed by its place and its value, so `9` to `10` changes the ones and brings the tens in
 * beside them, and `10` to `11` changes the ones alone. An arriving digit rolls in from below when the number
 * grows and from above when it shrinks; a leaving one fades where it stood, quicker than the arrival, so a
 * run of fast changes never leaves a stack of digits behind. The line clips the roll, and the digits that
 * stay glide to their new places on the morph spring when the width changes.
 *
 * Transform and opacity only, on the UI thread. Nothing moves on the first paint, and under reduce motion
 * the number simply changes.
 */
export function RollingNumber({
  direction,
  maxFontSizeMultiplier,
  style,
  value,
}: {
  /** Which way the change that produced `value` went. */
  readonly direction: 1 | -1;
  readonly maxFontSizeMultiplier?: number;
  /** The face the digits are set in. Its size decides how far they roll. */
  readonly style: TextStyle;
  readonly value: number;
}) {
  const reduceMotion = useReducedMotion();
  const digits = String(value).split('');
  const from = Math.round((style.fontSize ?? 17) * TRAVEL_SHARE) * direction;

  // Built each render, so a digit arriving takes the direction of the change it arrived with.
  const rollIn = () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: from }] },
      animations: {
        opacity: withTiming(1, { duration: IN_MS, easing: IN_EASING }),
        transform: [{ translateY: withTiming(0, { duration: IN_MS, easing: IN_EASING }) }],
      },
    };
  };

  return (
    <Animated.View {...(reduceMotion ? null : { layout: layoutMorph() })} style={styles.line}>
      <LayoutAnimationConfig skipEntering>
        {digits.map((digit, index) => (
          <Animated.View
            key={`${digits.length - 1 - index}-${digit}`}
            {...(reduceMotion
              ? null
              : { entering: rollIn, exiting: FadeOut.duration(OUT_MS), layout: layoutMorph() })}
          >
            <Text
              {...(maxFontSizeMultiplier === undefined ? null : { maxFontSizeMultiplier })}
              style={style}
            >
              {digit}
            </Text>
          </Animated.View>
        ))}
      </LayoutAnimationConfig>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Clips a rolling digit to the line it is rolling through.
  line: { flexDirection: 'row', overflow: 'hidden' },
});
