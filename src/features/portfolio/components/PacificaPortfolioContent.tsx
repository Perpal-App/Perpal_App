import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { layoutMorph } from '@/components/motion/layoutMorph';
import { RiseInView } from '@/components/motion/RiseInView';
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
import { colors, layout, motion, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Props = {
  readonly balances: WalletBalances | null;
  readonly balancesPending: boolean;
  readonly onBalancesChanged: () => void;
  readonly onVelocityRefresh: () => void;
  readonly portfolioPending: boolean;
  readonly portfolioUnavailable: boolean;
  readonly snapshot: PacificaPortfolioSnapshot | null;
  readonly velocity: VelocityAccountSnapshot | null;
  readonly velocityHistory: VelocityHistoryState;
  readonly velocityPending: boolean;
  readonly velocityUnavailable: boolean;
};

/**
 * Portfolio: what the account is worth, what is open against it, and how funds move.
 *
 * Stripped of the copy that used to sit under every heading — "Your funds and active trades",
 * "Deposit privately from public wallet M or withdraw from your private balance", "Trades and fund
 * movements". Each restated the heading above it in a longer form, and on a screen whose whole
 * purpose is figures they were the only thing that could not be scanned. The two funding buttons and
 * the sheets they open say what they do.
 *
 * Sections appear only when they have something in them, so an account with no positions shows no
 * empty "Positions" heading, and the screen is short because there is nothing to report rather than
 * because something failed to load.
 */
export function PacificaPortfolioContent({
  balances,
  balancesPending,
  onBalancesChanged,
  onVelocityRefresh,
  portfolioPending,
  portfolioUnavailable,
  snapshot,
  velocity,
  velocityHistory,
  velocityPending,
  velocityUnavailable,
}: Props) {
  const config = readAppConfig();
  const session = useTradingSession();
  const positions = snapshot?.positions ?? [];
  const orders = snapshot?.orders ?? [];
  const velocityPositions = velocity?.positions ?? [];
  const velocityOrders = velocity?.orders ?? [];

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
            Alert.alert('Cancellation failed', 'The order remains open. Try again.');
          });
        },
      },
    ],
  );

  return (
    <AppScreen contentContainerStyle={styles.container}>
      {/* Every block carries the same layout spring, and it has to be every one of them: Reanimated
          places a block further down at its final position on the frame after a change, so animating
          only the one that resized leaves its neighbours snapping around it. That matters here more
          than anywhere — positions and orders arrive and leave while the screen is open. */}
      <RiseInView layout={layoutMorph()}>
        <Text accessibilityRole="header" style={styles.title}>Portfolio</Text>
      </RiseInView>

      <RiseInView delay={motion.rise.stagger} layout={layoutMorph()}>
        <AccountOverviewCard
          balances={balances}
          balancesPending={balancesPending}
          portfolio={snapshot}
          portfolioPending={portfolioPending}
          velocity={velocity}
          velocityPending={velocityPending}
        />
      </RiseInView>

      {portfolioUnavailable || velocityUnavailable ? (
        <RiseInView layout={layoutMorph()}>
          <Text accessibilityRole="alert" selectable style={styles.alert}>
            Some active trades are temporarily unavailable. Your wallet balances remain visible.
          </Text>
        </RiseInView>
      ) : null}

      {positions.length === 0 ? null : (
        <RiseInView delay={motion.rise.stagger * 2} layout={layoutMorph()} style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Positions</Text>
          {positions.map((position) => (
            <PositionCard key={`${position.symbol}:${position.side}`} position={position} />
          ))}
        </RiseInView>
      )}

      {velocityPositions.length === 0 ? null : (
        <RiseInView delay={motion.rise.stagger * 2} layout={layoutMorph()} style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Velocity positions</Text>
          {velocityPositions.map((position) => (
            <VelocityPositionCard key={position.marketIndex} position={position} />
          ))}
        </RiseInView>
      )}

      {orders.length === 0 ? null : (
        <RiseInView delay={motion.rise.stagger * 2} layout={layoutMorph()} style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Orders</Text>
          {orders.map((order) => (
            <OrderCard key={order.orderId} onCancel={() => cancel(order)} order={order} />
          ))}
        </RiseInView>
      )}

      {velocityOrders.length === 0 ? null : (
        <RiseInView delay={motion.rise.stagger * 2} layout={layoutMorph()} style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Velocity orders</Text>
          {velocityOrders.map((order) => (
            <VelocityOrderCard key={order.orderId} order={order} />
          ))}
        </RiseInView>
      )}

      <RiseInView delay={motion.rise.stagger * 3} layout={layoutMorph()} style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>Funds</Text>
        {/* The screen already polls both of these for the overview card above, so they are handed down
            rather than fetched again inside the sheet — one owner per refresh. */}
        <Funds balances={balances} onBalancesChanged={onBalancesChanged} snapshot={snapshot} />
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 4} layout={layoutMorph()}>
        <GlobalActivityTracker
          account={session.address ?? ''}
          apiOrigin={config.ok ? config.value.perps.pacificaApiOrigin : ''}
          onVelocityRefresh={onVelocityRefresh}
          velocityHistory={velocityHistory}
        />
      </RiseInView>
    </AppScreen>
  );
}

/**
 * The two ways funds move, as one pair of actions.
 *
 * Deposit takes the accent material and withdraw the neutral one, which is the same primary and
 * secondary pairing the order bar uses for its two sides — one construction, different weight. The
 * sentence that used to sit above them explained which wallet each drew from; the sheet each one
 * opens states that at the point it matters.
 */
function Funds({
  balances,
  onBalancesChanged,
  snapshot,
}: {
  readonly balances: WalletBalances | null;
  readonly onBalancesChanged: () => void;
  readonly snapshot: PacificaPortfolioSnapshot | null;
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
          accessibilityHint="Opens the private wallet swap panel"
          label="Swap"
          onPress={() => setMode('swap')}
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
        snapshot={snapshot}
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
    // The floating bar draws over this screen, so the last row buys its own room.
    paddingBottom: TAB_BAR_CLEARANCE,
    gap: spacing.lg,
  },
  title: { ...typography.title, color: colors.textPrimary },
  // A section is its heading and its cards, separated from the block above by the screen's own gap
  // rather than by a rule. The hairlines that used to top every section drew four lines across a
  // screen that already had a card edge every few points.
  section: { gap: spacing.sm },
  heading: { ...typography.label, color: colors.textPrimary },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  alert: { ...typography.bodyCompact, color: colors.negative },
});
