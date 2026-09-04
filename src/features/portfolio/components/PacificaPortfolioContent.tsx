import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { readAppConfig } from '@/config/appConfig';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { AccountOverviewCard } from '@/features/home/components/AccountOverviewCard';
import { FundsSheet, type FundsRequest } from '@/features/portfolio/components/FundsSheet';
import { GlobalActivityTracker } from '@/features/portfolio/components/GlobalActivityTracker';
import {
  OrderCard,
  PositionCard,
} from '@/features/portfolio/components/PortfolioCards';
import { WalletAccountSection } from '@/features/portfolio/components/WalletAccountSection';
import { cancelPacificaOrder } from '@/integrations/perps/pacifica/pacificaOrder';
import type {
  PacificaOpenOrder,
  PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { TAB_BAR_CLEARANCE } from '@/navigation/tabs/GlassTabBar';
import { colors, layout, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Props = {
  readonly balances: WalletBalances | null;
  readonly onBalancesChanged: () => void;
  readonly onPacificaRefresh: () => void;
  readonly snapshot: PacificaPortfolioSnapshot | null;
};

export function PacificaPortfolioContent({
  balances,
  onBalancesChanged,
  onPacificaRefresh,
  snapshot,
}: Props) {
  const config = readAppConfig();
  const session = useTradingSession();
  const positions = snapshot?.positions ?? [];
  const orders = snapshot?.orders ?? [];
  const [fundsRequest, setFundsRequest] = useState<FundsRequest | null>(null);
  const hasPositions = positions.length > 0;
  const hasOrders = orders.length > 0;

  const cancel = (order: PacificaOpenOrder) => Alert.alert(
    `Cancel ${order.symbol} order?`,
    `${order.side === 'bid' ? 'Buy' : 'Sell'} ${order.initialAmount} at ${order.price}.`,
    [
      { text: 'Keep order', style: 'cancel' },
      {
        text: 'Confirm and sign',
        style: 'destructive',
        onPress: () => {
          if (!config.ok || session.address === null || session.signer === null) return;
          void cancelPacificaOrder({
            account: session.address,
            apiOrigin: config.value.perps.pacificaApiOrigin,
            orderId: order.orderId,
            signer: session.signer,
            symbol: order.symbol,
          }).then(() => {
            onPacificaRefresh();
            publishInAppNotification({
              kind: 'trade',
              outcome: 'success',
              title: 'Order cancelled',
              message: `${order.symbol} order was cancelled.`,
            });
          }).catch(() => {
            publishInAppNotification({
              kind: 'trade',
              outcome: 'error',
              title: 'Cancellation failed',
              message: `${order.symbol} order remains open.`,
            });
          });
        },
      },
    ],
  );

  return (
    <AppScreen contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>Portfolio</Text>

      <AccountOverviewCard balances={balances} portfolio={snapshot} />

      <WalletAccountSection
        balances={balances}
        onRequest={setFundsRequest}
        snapshot={snapshot}
      />

      {hasPositions ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Open positions</Text>
          {positions.map((position) => (
            <PositionCard key={`pacifica:${position.symbol}:${position.side}`} position={position} />
          ))}
        </View>
      ) : null}

      {hasOrders ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Open orders</Text>
          {orders.map((order) => (
            <OrderCard
              key={`pacifica:${order.orderId}`}
              onCancel={() => cancel(order)}
              order={order}
            />
          ))}
        </View>
      ) : null}

      <GlobalActivityTracker
        account={session.address ?? ''}
        apiOrigin={config.ok ? config.value.perps.pacificaApiOrigin : ''}
      />

      <FundsSheet
        balances={balances}
        onBalancesChanged={onBalancesChanged}
        onClose={() => setFundsRequest(null)}
        onPacificaRefresh={onPacificaRefresh}
        request={fundsRequest}
        snapshot={snapshot}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: TAB_BAR_CLEARANCE,
    gap: spacing.lg,
  },
  title: { ...typography.title, color: colors.textPrimary },
  section: { gap: spacing.sm },
  heading: { ...typography.label, color: colors.textPrimary },
});
