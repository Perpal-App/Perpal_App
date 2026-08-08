import { StyleSheet, Text, View, type DimensionValue } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { colors, spacing, typography } from '@/theme/tokens';

export function StatusRow({
  label,
  value,
  selectable = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly selectable?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={styles.row}
    >
      <Text style={styles.label}>{label}</Text>
      <Text
        numberOfLines={selectable ? undefined : 2}
        selectable={selectable}
        style={styles.value}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * A `StatusRow` whose data has not arrived yet.
 *
 * Lives beside the real row and shares its layout, so a screen can show the shape of
 * what is coming and then drop the values in without anything moving. Widths are
 * callers' business: varying them is what stops a column of these reading as a grid.
 */
export function StatusRowSkeleton({
  labelWidth,
  valueWidth,
}: {
  readonly labelWidth: DimensionValue;
  readonly valueWidth: DimensionValue;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.row}
    >
      <SkeletonText role="bodyCompact" width={labelWidth} />
      <SkeletonText align="right" role="bodyCompact" width={valueWidth} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  label: {
    ...typography.bodyCompact,
    flexShrink: 0,
    color: colors.textMuted,
  },
  value: {
    ...typography.bodyCompact,
    flex: 1,
    color: colors.textPrimary,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
