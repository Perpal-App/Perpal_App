import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppScreen } from '@/components/layout/AppScreen';
import { PressableScale } from '@/components/ui/PressableScale';
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
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

/** Short of the 48pt minimum on purpose; `hitSlop` buys the rest without inflating the chip. */
const ASSETS_HEIGHT = 32;

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
      {/* Assets sits up here rather than in the card. It is a drill-down on the whole screen's
          balances, not one of the three things you can do to them, and as a full-width row inside
          the card it carried the same weight as the funding actions above it. */}
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Portfolio</Text>
        <PressableScale
          accessibilityHint="Opens public and private token balances"
          accessibilityLabel="View assets"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => setFundsRequest({ mode: 'assets' })}
          pressedScale={0.97}
          style={styles.assets}
        >
          <Text maxFontSizeMultiplier={1.2} style={styles.assetsText}>Assets</Text>
          <ChevronIcon />
        </PressableScale>
      </View>

      <PortfolioSummaryCard
        balances={balances}
        onAction={(action) => setFundsRequest({ mode: action })}
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
        publicAccount={session.mainWalletAddress}
        rpcUrl={config.ok ? config.value.api.rpcUrl : ''}
        signer={session.signer}
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

function ChevronIcon() {
  return (
    <Svg height={14} viewBox="0 0 24 24" width={14}>
      <Path
        d="m9 6 6 6-6 6"
        fill="none"
        stroke={colors.textSecondary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.2}
      />
    </Svg>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: { ...typography.title, flexShrink: 1, color: colors.textPrimary },
  // Page chrome, not card chrome: `surface` and `border` rather than the glass tokens, because this
  // sits on the near-black page instead of on the violet panel.
  assets: {
    minHeight: ASSETS_HEIGHT,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  assetsText: { ...typography.caption, color: colors.textPrimary },
  section: { gap: spacing.sm },
  heading: { ...typography.label, color: colors.textPrimary },
});
