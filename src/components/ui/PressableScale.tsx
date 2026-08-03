import type { ReactNode } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<
  PressableProps,
  'children' | 'disabled' | 'onPressIn' | 'onPressOut' | 'style'
> & {
  children: ReactNode;
  disabled?: boolean;
  pressedScale?: number;
  style?: StyleProp<ViewStyle>;
};

/** UI-thread press feedback shared by buttons and icon controls. */
export function PressableScale({
  children,
  disabled = false,
  pressedScale = motion.pressScale,
  style,
  ...pressableProps
}: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!disabled && !reduceMotion) {
      scale.set(withSpring(pressedScale, motion.spring));
    }
  };

  const handlePressOut = () => {
    if (!disabled && !reduceMotion) {
      scale.set(withSpring(1, motion.spring));
    }
  };

  return (
    <AnimatedPressable
      {...pressableProps}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
