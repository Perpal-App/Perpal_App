import { useCallback, useEffect, type ReactNode } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressableScaleProps = Omit<
  PressableProps,
  'children' | 'disabled' | 'onPress' | 'onPressIn' | 'onPressOut' | 'style'
> & {
  children: ReactNode;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  pressedScale?: number;
  /**
   * Spring the press and its release run on. Defaults to the app's `motion.spring`, which is damped
   * enough to arrive without overshoot. Pass a slacker one — `motion.pressGooey` — where the control
   * should settle back through a bounce instead of stopping dead.
   */
  pressSpring?: Parameters<typeof withSpring>[1];
  /**
   * Cross-fades the control in on mount. Handled here rather than in a wrapper
   * so the fade and the press scale share one animated view instead of two
   * nested views writing competing styles.
   */
  fadeIn?: boolean;
  fadeDuration?: number;
  /**
   * Holds the control hidden for this many ms before it enters, so it can be
   * sequenced after other animations. Requires `fadeIn`.
   */
  fadeDelay?: number;
  /**
   * Distance in px the control slides up as it enters. Composed into the same
   * transform as the press scale, so the entrance and press feedback cannot
   * overwrite each other. Defaults to 0, i.e. fade with no movement.
   */
  enterOffsetY?: number;
  style?: StyleProp<ViewStyle>;
};

/** UI-thread press feedback shared by buttons and icon controls. */
export function PressableScale({
  children,
  onPress,
  disabled = false,
  pressedScale = motion.pressScale,
  pressSpring = motion.spring,
  fadeIn = false,
  fadeDuration = motion.fade.duration,
  fadeDelay = 0,
  enterOffsetY = 0,
  style,
  ...pressableProps
}: PressableScaleProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  const fades = fadeIn && !reduceMotion;
  // One value drives both the fade and the slide so they cannot drift apart.
  const enter = useSharedValue(fades ? 0 : 1);

  useEffect(() => {
    if (!fades) {
      enter.set(1);
      return;
    }

    enter.set(0);
    enter.set(
      withDelay(
        fadeDelay,
        withTiming(1, {
          duration: fadeDuration,
          easing: Easing.inOut(Easing.cubic),
        }),
      ),
    );
  }, [enter, fadeDelay, fadeDuration, fades]);

  const settle = useCallback(() => {
    scale.set(withSpring(1, pressSpring));
  }, [pressSpring, scale]);

  const handlePressIn = () => {
    if (!disabled && !reduceMotion) {
      scale.set(withSpring(pressedScale, pressSpring));
    }
  };

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      // Release the pressed state before running the handler: navigation can
      // freeze or unmount this screen before `onPressOut` is delivered, which
      // would otherwise leave the control stuck at its pressed scale.
      settle();
      onPress(event);
    },
    [onPress, settle],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: (1 - enter.value) * enterOffsetY },
      { scale: scale.value },
    ],
  }));

  return (
    <AnimatedPressable
      {...pressableProps}
      disabled={disabled}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={settle}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
