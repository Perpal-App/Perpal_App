import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

/**
 * A figure the reader should check before acting: a quiet label and the value a weight above it.
 *
 * One accessible element, so a screen reader hears the pair as one statement rather than a label and,
 * a swipe later, a number with no name.
 */
export function TicketFigure({
  label,
  screenReaderLabel,
  value,
}: {
  readonly label: string;
  /** The spoken name, where the visible one is abbreviated to fit. */
  readonly screenReaderLabel?: string;
  readonly value: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${screenReaderLabel ?? label}: ${value}`}
      style={styles.figure}
    >
      <Text numberOfLines={1} style={styles.label}>{label}</Text>
      <Text numberOfLines={1} style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  figure: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  label: { ...typography.bodyCompact, flexShrink: 0, color: colors.textSecondary },
  // The side that gives way on a narrow screen: the label names the row and must survive whole.
  value: { ...typography.label, flexShrink: 1, color: colors.textPrimary, textAlign: 'right' },
});
