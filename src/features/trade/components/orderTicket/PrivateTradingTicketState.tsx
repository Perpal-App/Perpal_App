import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';
import type { TradingSessionStatus } from '@/wallet/trading/TradingSessionProvider';
import { colors, interfaceType, spacing } from '@/theme/tokens';

/** The ticket while the private trading wallet is not ready to sign: preparing, or needing attention. */
export function PrivateTradingTicketState(props: {
  readonly baseAsset: string;
  readonly onRetry: () => void;
  readonly status: TradingSessionStatus;
}) {
  const router = useRouter();
  if (isPreparing(props.status)) {
    return (
      <View accessibilityLabel="Preparing private trading" style={styles.state}>
        <SkeletonText role="heading" width={180} />
        <SkeletonText role="bodyCompact" width="100%" />
      </View>
    );
  }
  return (
    <View style={styles.state}>
      <Text accessibilityRole="header" style={styles.title}>Trade {props.baseAsset}</Text>
      <Text style={styles.message}>Private trading setup needs attention.</Text>
      <Button
        label={props.status === 'error' ? 'Retry setup' : 'Open Wallet'}
        onPress={props.status === 'error' ? props.onRetry : () => router.push('/(tabs)/account')}
      />
    </View>
  );
}

function isPreparing(status: TradingSessionStatus): boolean {
  return status === 'waiting-for-wallet' ||
    status === 'restoring' ||
    status === 'inactive' ||
    status === 'activating' ||
    status === 'rotating';
}

const styles = StyleSheet.create({
  state: { gap: spacing.sm, paddingVertical: spacing.xs },
  title: { ...interfaceType.title, color: colors.textPrimary },
  message: { ...interfaceType.body, color: colors.textSecondary },
});
