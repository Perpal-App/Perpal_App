import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';
import { pacificaOrderTicketStyles as styles } from '@/features/trade/components/PacificaOrderTicketStyles';
import type { TradingSessionStatus } from '@/wallet/trading/TradingSessionProvider';

export function PrivateTradingTicketState(props: {
  readonly baseAsset: string;
  readonly onRetry: () => void;
  readonly status: TradingSessionStatus;
}) {
  const router = useRouter();
  if (isPreparing(props.status)) {
    return (
      <View accessibilityLabel="Preparing private trading" style={styles.panel}>
        <SkeletonText role="heading" width={180} />
        <SkeletonText role="bodyCompact" width="100%" />
      </View>
    );
  }
  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.title}>Trade {props.baseAsset}</Text>
      <Text style={styles.message}>Private trading setup needs attention.</Text>
      <Button
        label={props.status === 'error' ? 'Retry setup' : 'Open Wallet'}
        onPress={props.status === 'error'
          ? props.onRetry
          : () => router.push('/(tabs)/account')}
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
