import { useEffect } from 'react';
import {
  StyleSheet,
  View,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/theme/tokens';

/** Tapered spokes, matching the iOS activity indicator's 8-petal wheel. */
const SPOKE_COUNT = 8;
const REVOLUTION_MS = 800;
const MIN_SPOKE_OPACITY = 0.16;

const SIZES = { small: 20, large: 36 } as const;

type IOSLoaderProps = {
  accessibilityLabel?: string;
  color?: ColorValue;
  /** Grows to fill the available area and centres itself. */
  fill?: boolean;
  size?: 'small' | 'large' | number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Spinner for work the user just asked for, shown inside the control that asked for it:
 * a button that is submitting, a text action that is sending a code.
 *
 * Not for screens. A screen waiting on data uses `Skeleton`/`SkeletonText` placeholders
 * in the shape of the content that is coming, which say what is being waited for and let
 * the real values land without moving anything. A spinner centred on a screen can only
 * say "wait", and then it vanishes and drops the whole layout in from nowhere. Whether
 * the app is still restoring a session is likewise not something to announce — that state
 * renders the bare background, which is what the launch screen already shows.
 *
 * Drawn from primitives rather than `ActivityIndicator`, which renders the Material
 * circular spinner on Android. This keeps one identical spinner on both platforms. Only
 * `transform` and `opacity` animate, on the UI thread, so it never triggers a layout
 * pass; under reduce motion the wheel is shown static.
 */
export function IOSLoader({
  accessibilityLabel = 'Loading',
  color = colors.accent,
  fill = false,
  size = 'small',
  style,
}: IOSLoaderProps) {
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(0);

  const diameter = typeof size === 'number' ? size : SIZES[size];
  const spokeWidth = Math.max(2, Math.round(diameter * 0.1));
  const spokeHeight = Math.round(diameter * 0.3);
  const spokeOffset = -diameter * 0.35;

  useEffect(() => {
    if (reduceMotion) {
      rotation.set(0);
      return;
    }

    rotation.set(0);
    rotation.set(
      withRepeat(
        withTiming(360, { duration: REVOLUTION_MS, easing: Easing.linear }),
        -1,
      ),
    );
  }, [reduceMotion, rotation]);

  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      style={[styles.base, fill && styles.fill, style]}
    >
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[{ width: diameter, height: diameter }, wheelStyle]}
      >
        {Array.from({ length: SPOKE_COUNT }, (_, index) => (
          <View
            key={index}
            style={[
              styles.spoke,
              {
                width: spokeWidth,
                height: spokeHeight,
                borderRadius: spokeWidth / 2,
                backgroundColor: color,
                marginLeft: -spokeWidth / 2,
                marginTop: -spokeHeight / 2,
                opacity: Math.max(
                  MIN_SPOKE_OPACITY,
                  1 - index / SPOKE_COUNT,
                ),
                transform: [
                  { rotate: `${(index * 360) / SPOKE_COUNT}deg` },
                  { translateY: spokeOffset },
                ],
              },
            ]}
          />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    flexGrow: 1,
    width: '100%',
  },
  spoke: {
    position: 'absolute',
    // Anchored at the wheel's centre; negative margins offset the spoke's own
    // box so it rotates around that centre point.
    top: '50%',
    left: '50%',
  },
});
