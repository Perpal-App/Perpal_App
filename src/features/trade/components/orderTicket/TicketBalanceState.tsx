import { StyleSheet, Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { ActionButton } from '@/components/ui/ActionButton';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * The ticket before the account has answered: placeholders while it loads, a retry if the read failed.
 *
 * A stable skeleton rather than a spinner, and only while the one fact the ticket cannot draw without is
 * genuinely pending — the balance that decides whether this is an order or a deposit.
 */
export function TicketBalanceState({
  failed,
  onRetry,
}: {
  readonly failed: boolean;
  readonly onRetry: () => void;
}) {
  if (!failed) {
    return (
      <View accessibilityLabel="Loading Pacifica balance" style={styles.state}>
        <SkeletonText role="heading" width={92} />
        <SkeletonText role="label" width="100%" />
        <SkeletonText role="label" width="100%" />
      </View>
    );
  }
  return (
    <View style={styles.state}>
      <Text accessibilityRole="alert" style={styles.error}>Pacifica balance refresh failed.</Text>
      <ActionButton label="Retry balance" onPress={onRetry} tone="neutral" />
    </View>
  );
}

const styles = StyleSheet.create({
  state: { minHeight: 180, justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  error: { ...typography.bodyCompact, color: colors.negative },
});
