import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { ActionButton } from '@/components/ui/ActionButton';
import { readAppConfig } from '@/config/appConfig';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { AccountOverviewCard } from '@/features/home/components/AccountOverviewCard';
import { FundsSheet, type FundsMode } from '@/features/portfolio/components/FundsSheet';
import { GlobalActivityTracker } from '@/features/portfolio/components/GlobalActivityTracker';
import {
  OrderCard,
  PositionCard,
  VelocityOrderCard,
  VelocityPositionCard,
} from '@/features/portfolio/components/PortfolioCards';
import type { VelocityHistoryState } from '@/features/portfolio/hooks/useVelocityAccount';
import { cancelPacificaOrder } from '@/integrations/perps/pacifica/pacificaOrder';
import type {
  PacificaOpenOrder,
  PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import type { VelocityAccountSnapshot } from '@/integrations/perps/velocity/velocityAccount';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { TAB_BAR_CLEARANCE } from '@/navigation/tabs/GlassTabBar';
import { colors, layout, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Props = {
  readonly balances: WalletBalances | null;
  readonly onBalancesChanged: () => void;
  readonly onPacificaRefresh: () => void;
  readonly onVelocityRefresh: () => void;
  readonly snapshot: PacificaPortfolioSnapshot | null;
  readonly velocity: VelocityAccountSnapshot | null;
  readonly velocityHistory: VelocityHistoryState;
};

export function PacificaPortfolioContent({
  balances,
  onBalancesChanged,
  onPacificaRefresh,
  onVelocityRefresh,
  snapshot,
  velocity,
  velocityHistory,
}: Props) {
  const config = readAppConfig();
  const session = useTradingSession();
  const positions = snapshot?.positions ?? [];
  const orders = snapshot?.orders ?? [];
  const velocityPositions = velocity?.positions ?? [];
  const velocityOrders = velocity?.orders ?? [];
  const hasPositions = positions.length > 0 || velocityPositions.length > 0;
  const hasOrders = orders.length > 0 || velocityOrders.length > 0;

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

      <AccountOverviewCard balances={balances} portfolio={snapshot} velocity={velocity} />

      {hasPositions ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Open positions</Text>
          {positions.map((position) => (
            <PositionCard key={`pacifica:${position.symbol}:${position.side}`} position={position} />
          ))}
          {velocityPositions.map((position) => (
            <VelocityPositionCard key={`velocity:${position.marketIndex}`} position={position} />
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
          {velocityOrders.map((order) => (
            <VelocityOrderCard key={`velocity:${order.orderId}`} order={order} />
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>Funds</Text>
        <Funds
          balances={balances}
          onBalancesChanged={onBalancesChanged}
          onPacificaRefresh={onPacificaRefresh}
          onVelocityRefresh={onVelocityRefresh}
          snapshot={snapshot}
          velocity={velocity}
        />
      </View>

      <GlobalActivityTracker
        account={session.address ?? ''}
        apiOrigin={config.ok ? config.value.perps.pacificaApiOrigin : ''}
        onVelocityRefresh={onVelocityRefresh}
        velocityHistory={velocityHistory}
      />
    </AppScreen>
  );
}

function Funds({
  balances,
  onBalancesChanged,
  onPacificaRefresh,
  onVelocityRefresh,
  snapshot,
  velocity,
}: {
  readonly balances: WalletBalances | null;
  readonly onBalancesChanged: () => void;
  readonly onPacificaRefresh: () => void;
  readonly onVelocityRefresh: () => void;
  readonly snapshot: PacificaPortfolioSnapshot | null;
  readonly velocity: VelocityAccountSnapshot | null;
}) {
  const [mode, setMode] = useState<FundsMode | null>(null);

  return (
    <>
      <View style={styles.actions}>
        <ActionButton
          accessibilityHint="Opens the private funding panel"
          label="Deposit"
          onPress={() => setMode('deposit')}
          style={styles.action}
        />
        <ActionButton
          accessibilityHint="Opens the private balance swap panel"
          label="Swap"
          onPress={() => setMode('swap')}
          style={styles.action}
          tone="neutral"
        />
        <ActionButton
          accessibilityHint="Returns available provider collateral to your private balance"
          label="Return"
          onPress={() => setMode('providers')}
          style={styles.action}
          tone="neutral"
        />
        <ActionButton
          accessibilityHint="Opens the withdrawal panel"
          label="Withdraw"
          onPress={() => setMode('withdraw')}
          style={styles.action}
          tone="neutral"
        />
      </View>
      <FundsSheet
        balances={balances}
        mode={mode}
        onClose={() => setMode(null)}
        onBalancesChanged={onBalancesChanged}
        onPacificaRefresh={onPacificaRefresh}
        onVelocityRefresh={onVelocityRefresh}
        snapshot={snapshot}
        velocity={velocity}
      />
    </>
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { flexGrow: 1, flexBasis: '42%' },
});
