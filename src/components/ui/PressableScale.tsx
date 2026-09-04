import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
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
  pressedOpacity?: number;
  pressedScale?: number;
  pressedScaleX?: number;
  pressedScaleY?: number;
  pressedTranslateY?: number;
  /** Completes a short compression before invoking `onPress`, so navigation cannot hide the tap. */
  pressBeforeAction?: boolean;
  pressPeakDuration?: number;
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

/** Shared transform-only press sequence for controls that must visibly yield before acting. */
export const GOOEY_PRESS_EFFECT = {
  pressBeforeAction: true,
  pressPeakDuration: 90,
  pressSpring: motion.pressGooey,
  pressedOpacity: 0.96,
  pressedScale: 0.94,
  pressedScaleX: 1.025,
  pressedScaleY: 0.9,
  pressedTranslateY: 2,
} as const;

/** UI-thread press feedback shared by buttons and icon controls. */
export function PressableScale({
  children,
  onPress,
  disabled = false,
  pressedOpacity = 1,
  pressedScale = motion.pressScale,
  pressedScaleX,
  pressedScaleY,
  pressedTranslateY = 0,
  pressBeforeAction = false,
  pressPeakDuration = 90,
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
  const pendingPress = useRef<GestureResponderEvent | null>(null);

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
    if (!disabled && !reduceMotion && pendingPress.current === null) {
      scale.set(withSpring(pressedScale, pressSpring));
    }
  };

  const handlePressOut = () => {
    if (pendingPress.current === null) settle();
  };

  const firePendingPress = useCallback(() => {
    const event = pendingPress.current;
    if (event === null) return;
    pendingPress.current = null;
    onPress(event);
  }, [onPress]);

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (pressBeforeAction && !reduceMotion) {
        if (pendingPress.current !== null) return;
        event.persist();
        pendingPress.current = event;
        scale.set(
          withSequence(
            withTiming(
              pressedScale,
              {
                duration: pressPeakDuration,
                easing: Easing.out(Easing.cubic),
              },
              (finished) => {
                if (finished) runOnJS(firePendingPress)();
              },
            ),
            withSpring(1, pressSpring),
          ),
        );
        return;
      }

      // Release the pressed state before running the handler: navigation can
      // freeze or unmount this screen before `onPressOut` is delivered, which
      // would otherwise leave the control stuck at its pressed scale.
      settle();
      onPress(event);
    },
    [
      firePendingPress,
      onPress,
      pressBeforeAction,
      pressedScale,
      pressPeakDuration,
      pressSpring,
      reduceMotion,
      scale,
      settle,
    ],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const scaleRange = 1 - pressedScale;
    const pressProgress = scaleRange === 0
      ? 0
      : Math.max(0, Math.min(1, (1 - scale.value) / scaleRange));
    const scaleX = 1 + ((pressedScaleX ?? pressedScale) - 1) * pressProgress;
    const scaleY = 1 + ((pressedScaleY ?? pressedScale) - 1) * pressProgress;

    return {
      opacity: enter.value * (1 - (1 - pressedOpacity) * pressProgress),
      transform: [
        {
          translateY:
            (1 - enter.value) * enterOffsetY + pressedTranslateY * pressProgress,
        },
        { scaleX },
        { scaleY },
      ],
    };
  });

  return (
    <AnimatedPressable
      {...pressableProps}
      disabled={disabled}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
