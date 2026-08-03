import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme/tokens';

type StepIndicatorProps = {
  activeIndex: number;
  total: number;
};

export function StepIndicator({ activeIndex, total }: StepIndicatorProps) {
  return (
    <View
      accessibilityLabel={`Step ${activeIndex + 1} of ${total}`}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 1, max: total, now: activeIndex + 1 }}
      style={styles.container}
    >
      {Array.from({ length: total }, (_, index) => (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          key={index}
          style={[styles.step, index === activeIndex && styles.activeStep]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  step: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.textMuted,
    opacity: 0.55,
  },
  activeStep: {
    width: 30,
    backgroundColor: colors.textPrimary,
    opacity: 1,
  },
});
