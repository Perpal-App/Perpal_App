import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { readAppConfig } from '@/config/appConfig';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { FundsSheet, type FundsRequest } from '@/features/portfolio/components/FundsSheet';
import { GlobalActivityTracker } from '@/features/portfolio/components/GlobalActivityTracker';
import { PortfolioSummaryCard } from '@/features/portfolio/components/PortfolioSummaryCard';
import {
  OrderCard,
  PositionCard,
} from '@/features/portfolio/components/PortfolioCards';
import {
  cancelPacificaOrder,
  PacificaCommandPendingError,
} from '@/integrations/perps/pacifica/pacificaOrder';
import type {
  PacificaOpenOrder,
  PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
} from '@/storage/inAppNotifications';
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
          const scopeToken = captureInAppNotificationScope();
          void cancelPacificaOrder({
            account: session.address,
            apiOrigin: config.value.perps.pacificaApiOrigin,
            clientOrderId: order.clientOrderId,
            orderId: order.orderId,
            signer: session.signer,
            symbol: order.symbol,
          }).then((result) => {
            onPacificaRefresh();
            publishInAppNotification({
              correlations: [{
                namespace: 'pacifica-order',
                value: order.clientOrderId ?? String(order.orderId),
              }],
              kind: 'trade',
              outcome: result.status === 'cancelled'
                ? 'success'
                : result.status === 'not_cancelled'
                  ? 'error'
                  : 'info',
              scopeToken,
              status: result.status === 'cancelled'
                ? 'cancelled'
                : result.status === 'pending'
                  ? 'submitted'
                  : result.status === 'not_cancelled'
                    ? 'accepted'
                    : result.orderStatus === 'filled'
                      ? 'filled'
                      : 'failed',
              title: result.status === 'cancelled'
                ? 'Order cancelled'
                : result.status === 'pending'
                  ? 'Cancellation reconciling'
                  : result.status === 'not_cancelled'
                    ? 'Cancellation not confirmed'
                    : 'Order already closed',
              message: result.status === 'cancelled'
                ? `${order.symbol} order was cancelled.`
                : result.status === 'pending'
                  ? 'Pacifica may have received the cancellation. Do not submit it again.'
                  : result.status === 'not_cancelled'
                    ? `${order.symbol} order remains open. Refresh and retry the cancellation.`
                    : `${order.symbol} order is already ${result.orderStatus?.replace('_', ' ')}.`,
            });
          }).catch((cause) => {
            publishInAppNotification({
              correlations: [{
                namespace: 'pacifica-order',
                value: order.clientOrderId ?? String(order.orderId),
              }],
              kind: 'trade',
              outcome: cause instanceof PacificaCommandPendingError ? 'info' : 'error',
              scopeToken,
              status: cause instanceof PacificaCommandPendingError ? 'submitted' : 'failed',
              title: cause instanceof PacificaCommandPendingError
                ? 'Command still reconciling'
                : 'Cancellation not accepted',
              message: cause instanceof Error ? cause.message : 'Refresh the order before retrying.',
            });
          });
        },
      },
    ],
  );

  return (
    <AppScreen contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>Portfolio</Text>

      <PortfolioSummaryCard
        balances={balances}
        onAction={(action) => setFundsRequest({ mode: action })}
        onViewAssets={() => setFundsRequest({ mode: 'assets' })}
        portfolio={snapshot}
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
        generation={session.generation}
        pacificaProgramId={config.ok ? config.value.perps.pacificaProgramId : ''}
        publicAccount={session.mainWalletAddress}
        rpcUrl={config.ok ? config.value.api.rpcUrl : ''}
        signer={session.signer}
        usdcMint={config.ok ? config.value.perps.usdcMint : ''}
        usdtMint={config.ok ? config.value.perps.usdtMint : ''}
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
  title: { ...typography.title, flexShrink: 1, color: colors.textPrimary },
  section: { gap: spacing.sm },
  heading: { ...typography.label, color: colors.textPrimary },
});
