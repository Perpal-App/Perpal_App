import type { ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useConcealProgress } from '@/components/motion/useConcealProgress';
import { motion } from '@/theme/tokens';

/**
 * What stands in for a concealed figure.
 *
 * Fixed length, and that is the point: a mask whose width tracked the value would announce the
 * magnitude of the balance it was covering, which is most of what someone hiding it wants back.
 * Four dots rather than the asterisks that were here before — dots read as covered digits, where
 * asterisks read as a footnote — and short enough to sit inside the narrowest figure these screens
 * show without being clipped by the frame that holds the real value's width.
 */
export const CONCEALED_MASK = '••••';

type ConcealedValueProps = Omit<TextProps, 'children' | 'selectable' | 'style'> & {
  readonly hidden: boolean;
  /**
   * Applied to the mask only, on top of `style`. Exists for a figure whose colour carries meaning:
   * a rate tinted green or red has to reach a neutral tone once it is concealed, and setting that on
   * `style` would recolour the real value on its way out too, so the number would turn grey before it
   * had finished leaving. Given to the mask alone, the cross-fade does the colour change for free.
   */
  readonly maskStyle?: StyleProp<TextStyle>;
  readonly selectable?: boolean;
  readonly style?: StyleProp<TextStyle>;
  readonly value: string;
};

/**
 * Masks a figure without changing the measured width or height of its original value.
 *
 * The real value is always mounted and always in flow — that is what fixes the frame's size, so a
 * balance and its mask cannot be different widths and toggling privacy never reflows the card. The
 * mask is absolutely positioned inside that frame, so it costs no layout at all.
 *
 * The two cross-fade rather than swapping on the frame the boolean flips. Both are always rendered
 * now; before, the mask was mounted on demand, which is why the change was instant whatever else was
 * animating around it.
 */
export function ConcealedValue({
  hidden,
  maskStyle,
  maxFontSizeMultiplier,
  selectable = true,
  style,
  value,
  ...textProps
}: ConcealedValueProps) {
  const conceal = useConcealProgress(hidden);

  const valueStyle = useAnimatedStyle(() => ({
    opacity: 1 - conceal.value,
    transform: [
      { translateY: -conceal.value * motion.conceal.travel },
      { scale: 1 - (1 - motion.conceal.scale) * conceal.value },
    ],
  }));

  const maskedStyle = useAnimatedStyle(() => ({
    opacity: conceal.value,
    transform: [
      { translateY: (1 - conceal.value) * motion.conceal.travel },
      { scale: motion.conceal.scale + (1 - motion.conceal.scale) * conceal.value },
    ],
  }));

  return (
    <View
      accessible={hidden}
      style={styles.frame}
      {...(hidden ? { accessibilityLabel: 'Hidden value' } : {})}
    >
      <Animated.Text
        {...textProps}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        // Selection is released the instant the toggle is tapped rather than when the fade lands: a
        // figure that can still be selected and copied is not concealed, however faint it looks.
        selectable={selectable && !hidden}
        style={[style, valueStyle]}
      >
        {value}
      </Animated.Text>
      <Animated.Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        numberOfLines={1}
        pointerEvents="none"
        style={[style, styles.mask, maskStyle, maskedStyle]}
      >
        {CONCEALED_MASK}
      </Animated.Text>
    </View>
  );
}

/**
 * Fades anything that is not a figure but belongs to one — a trend arrow, a row of token logos — on
 * the same curve and the same clock as the numbers beside it.
 *
 * Keeps its footprint in both states, so what it holds can disappear without the row it sits in
 * moving. These were `opacity: 0` styles applied straight from the boolean, which meant the one
 * un-animated element on the card was always the one attached to a figure that was animating.
 */
export function ConcealFade({
  children,
  hidden,
  style,
}: {
  readonly children: ReactNode;
  readonly hidden: boolean;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const conceal = useConcealProgress(hidden);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: 1 - conceal.value }));

  return (
    <Animated.View
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      pointerEvents={hidden ? 'none' : 'auto'}
      style={[style, fadeStyle]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'relative', minWidth: 0 },
  // `pointerEvents` here as well as on the element, because this layer is now mounted permanently
  // rather than only while concealed. Sitting transparent on top of a revealed, selectable figure, it
  // would otherwise be the thing a long press lands on and selection would quietly stop working.
  mask: { position: 'absolute', inset: 0, pointerEvents: 'none' },
});
