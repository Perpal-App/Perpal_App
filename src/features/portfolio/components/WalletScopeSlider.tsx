import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { colors, radii, spacing, typography } from '@/theme/tokens';

export type WalletScope = 'private' | 'public';

export function WalletScopeSlider({
  onSelect,
  progress,
  selected,
}: {
  readonly onSelect: (scope: WalletScope) => void;
  readonly progress: SharedValue<number>;
  readonly selected: WalletScope;
}) {
  const [width, setWidth] = useState(0);
  const dragStart = useSharedValue(0);
  const travel = Math.max((width - spacing.xxs * 2) / 2, 0);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-12, 12])
    .onStart(() => {
      dragStart.set(progress.value);
    })
    .onUpdate((event) => {
      if (travel <= 0) return;
      progress.set(Math.min(1, Math.max(0, dragStart.value + event.translationX / travel)));
    })
    .onEnd((event) => {
      const target = event.velocityX > 240
        ? 1
        : event.velocityX < -240
          ? 0
          : progress.value >= 0.5 ? 1 : 0;
      runOnJS(onSelect)(target === 0 ? 'public' : 'private');
    }), [dragStart, onSelect, progress, travel]);

  const indicatorStyle = useAnimatedStyle(() => ({
    width: travel,
    transform: [{ translateX: progress.value * travel }],
  }));

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  return (
    <GestureDetector gesture={pan}>
      <View
        accessibilityLabel="Wallet view"
        accessibilityRole="tablist"
        onLayout={onLayout}
        style={styles.track}
      >
        <Animated.View pointerEvents="none" style={[styles.indicator, indicatorStyle]} />
        {(['public', 'private'] as const).map((scope) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: selected === scope }}
            hitSlop={4}
            key={scope}
            onPress={() => onSelect(scope)}
            style={styles.option}
          >
            <Text style={[styles.label, selected === scope && styles.labelSelected]}>
              {scope === 'public' ? 'Public' : 'Private'}
            </Text>
          </Pressable>
        ))}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  track: {
    minHeight: 44,
    flexDirection: 'row',
    overflow: 'hidden',
    padding: spacing.xxs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  indicator: {
    position: 'absolute',
    top: spacing.xxs,
    bottom: spacing.xxs,
    left: spacing.xxs,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
  },
  option: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  label: { ...typography.label, color: colors.textMuted },
  labelSelected: { color: colors.textPrimary },
});
