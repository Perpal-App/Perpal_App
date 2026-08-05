import { StyleSheet, Text, View } from 'react-native';

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
