import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { colors, interfaceType, motion, spacing } from '@/theme/tokens';

/**
 * A figure the reader should check before acting: a quiet label and the value a weight above it.
 *
 * One accessible element, so a screen reader hears the pair as one statement rather than a label and,
 * a swipe later, a number with no name.
 *
 * A `null` value is one still being worked out. The label is drawn and a placeholder holds the value's
 * place at the same height, so when the value lands nothing moves; it fades up where the placeholder was.
 */
export function TicketFigure({
  label,
  pendingWidth = 72,
  screenReaderLabel,
  value,
}: {
  readonly label: string;
  /** Width of the placeholder while `value` is `null`. */
  readonly pendingWidth?: number;
  /** The spoken name, where the visible one is abbreviated to fit. */
  readonly screenReaderLabel?: string;
  readonly value: string | null;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <View
      accessible
      accessibilityLabel={`${screenReaderLabel ?? label}: ${value ?? 'loading'}`}
      style={styles.figure}
    >
      <Text numberOfLines={1} style={styles.label}>{label}</Text>
      {value === null ? (
        <SkeletonText align="right" role="label" width={pendingWidth} />
      ) : (
        <Animated.Text
          {...(reduceMotion ? null : { entering: FadeIn.duration(motion.rowSwap.fadeMs) })}
          numberOfLines={1}
          style={styles.value}
        >
          {value}
        </Animated.Text>
      )}
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
  label: { ...interfaceType.body, flexShrink: 0, color: colors.textSecondary },
  // The side that gives way on a narrow screen: the label names the row and must survive whole. Tabular,
  // so a column of these ends every value on the same edge.
  value: { ...interfaceType.figure, flexShrink: 1, color: colors.textPrimary, textAlign: 'right' },
});
