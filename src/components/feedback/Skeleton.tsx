import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, gradients, motion, radii, typography } from '@/theme/tokens';

/**
 * One clock for every skeleton in the app.
 *
 * A screen waiting on data can hold dozens of placeholders, and giving each its
 * own loop would mean dozens of UI-thread animations drifting out of phase. This
 * single shared value is retained while any skeleton is mounted and cancelled
 * when the last one leaves, so the sheen crosses the screen as one front and
 * costs one animation no matter how many placeholders are on it.
 */
const sweep = makeMutable(0);
let holders = 0;

function retainSweep(): () => void {
  holders += 1;

  if (holders === 1) {
    sweep.set(0);
    sweep.set(
      withRepeat(
        withTiming(1, {
          duration: motion.shimmer.duration,
          easing: Easing.inOut(Easing.quad),
        }),
        -1,
        false,
      ),
    );
  }

  return () => {
    holders -= 1;
    if (holders === 0) cancelAnimation(sweep);
  };
}

type SkeletonProps = {
  /** Height of the placeholder block, in px. */
  readonly height: number;
  /** Any width the layout accepts; defaults to filling the parent. */
  readonly width?: DimensionValue;
  readonly radius?: number;
  readonly style?: StyleProp<ViewStyle>;
};

/**
 * A placeholder block with a highlight travelling across it.
 *
 * Only `transform` is animated, on the UI thread, over a static surface — no
 * layout property moves, so a screen full of these costs nothing in layout. The
 * sweep's travel needs the block's real width, so it starts on the first layout
 * pass; until then the block renders as a plain surface, which is also what it
 * stays as under the OS reduce-motion setting.
 */
export function Skeleton({
  height,
  width = '100%',
  radius = radii.sm,
  style,
}: SkeletonProps) {
  const reduceMotion = useReducedMotion();
  const [span, setSpan] = useState(0);

  useEffect(() => {
    if (reduceMotion) return undefined;
    return retainSweep();
  }, [reduceMotion]);

  const sheen = useAnimatedStyle(() => ({
    // Travels a full width past each edge, so the highlight enters and leaves
    // instead of appearing mid-block.
    transform: [{ translateX: -span + sweep.value * span * 2 }],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setSpan(event.nativeEvent.layout.width)}
      style={[styles.block, { width, height, borderRadius: radius }, style]}
    >
      {reduceMotion || span === 0 ? null : (
        <Animated.View style={[styles.sheen, { width: span }, sheen]}>
          <LinearGradient
            colors={gradients.shimmer.colors}
            end={{ x: 1, y: 0.5 }}
            locations={gradients.shimmer.locations}
            start={{ x: 0, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

/**
 * A skeleton sized to stand in for one line of text.
 *
 * The wrapper takes the full line height of the type role it replaces while the
 * bar inside is only as tall as the glyphs, so swapping the skeleton for the real
 * text changes nothing about the layout — the row keeps its height and nothing
 * below it moves when the value lands.
 */
export function SkeletonText({
  align = 'left',
  role = 'label',
  width,
}: {
  readonly align?: 'left' | 'right';
  readonly role?:
    | 'eyebrow'
    | 'label'
    | 'caption'
    | 'body'
    | 'bodyCompact'
    | 'heading'
    | 'title';
  readonly width: DimensionValue;
}) {
  const line = typography[role];

  return (
    <View
      style={[
        styles.line,
        { height: line.lineHeight },
        align === 'right' && styles.lineEnd,
      ]}
    >
      <Skeleton height={Math.round(line.fontSize * 0.7)} width={width} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { overflow: 'hidden', backgroundColor: colors.surfaceElevated },
  sheen: { position: 'absolute', top: 0, bottom: 0 },
  line: { justifyContent: 'center', alignItems: 'flex-start' },
  lineEnd: { alignItems: 'flex-end' },
});
