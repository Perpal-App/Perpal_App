import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/ui/PressableScale';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig } from '@/config/appConfig';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { PrivateFundingPanel } from '@/features/account/private-funding';
import { AccountOverviewCard } from '@/features/home/components/AccountOverviewCard';
import { GlobalActivityTracker } from '@/features/portfolio/components/GlobalActivityTracker';
import { PrivateWithdrawPanel } from '@/features/portfolio/components/PrivateWithdrawPanel';
import { cancelPacificaOrder } from '@/integrations/perps/pacifica/pacificaOrder';
import type {
  PacificaOpenOrder,
  PacificaPortfolioSnapshot,
  PacificaPosition,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Props = {
  readonly balances: WalletBalances | null;
  readonly balancesPending: boolean;
  readonly portfolioPending: boolean;
  readonly portfolioUnavailable: boolean;
  readonly snapshot: PacificaPortfolioSnapshot | null;
};

export function PacificaPortfolioContent({
  balances,
  balancesPending,
  portfolioPending,
  portfolioUnavailable,
  snapshot,
}: Props) {
  const config = readAppConfig();
  const session = useTradingSession();
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
    <AppScreen>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>Portfolio</Text>
          <Text selectable style={styles.subtitle}>Your funds and active trades</Text>
        </View>

        <AccountOverviewCard
          balances={balances}
          balancesPending={balancesPending}
          portfolio={snapshot}
          portfolioPending={portfolioPending}
        />

        {portfolioUnavailable ? (
          <Text accessibilityRole="alert" selectable style={styles.note}>
            Active trades are temporarily unavailable. Your wallet balances remain visible.
          </Text>
        ) : null}

        {snapshot !== null && (snapshot.positions.length > 0 || snapshot.orders.length > 0) ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>Positions and orders</Text>
          {snapshot?.positions.length ? (
            <View style={styles.list}>
              <Text accessibilityRole="header" style={styles.subheading}>Open positions</Text>
              {snapshot.positions.map((position) => (
                <Position key={`${position.symbol}:${position.side}`} position={position} />
              ))}
            </View>
          ) : null}
          {snapshot?.orders.length ? (
            <View style={styles.list}>
              <Text accessibilityRole="header" style={styles.subheading}>Open orders</Text>
              {snapshot.orders.map((order) => (
                <View key={order.orderId} style={styles.listItem}>
                  <StatusRow label="Market" value={order.symbol} />
                  <StatusRow label="Side" value={order.side === 'bid' ? 'Buy / long' : 'Sell / short'} />
                  <StatusRow label="Amount" value={order.initialAmount} />
                  <StatusRow label="Price" value={usd(order.price)} />
                  <Button label="Cancel order" onPress={() => cancel(order)} variant="secondary" />
                </View>
              ))}
            </View>
          ) : null}
          </View>
        ) : null}

        <Funds />

        <GlobalActivityTracker
          account={session.address ?? ''}
          apiOrigin={config.ok ? config.value.perps.pacificaApiOrigin : ''}
        />
      </View>
    </AppScreen>
  );
}

function Funds() {
  const [active, setActive] = useState<'deposit' | 'withdraw' | null>(null);

  return (
    <View style={styles.section}>
      <View style={styles.sectionCopy}>
        <Text accessibilityRole="header" style={styles.heading}>Funds</Text>
        <Text selectable style={styles.note}>
          Deposit privately from public wallet M or withdraw from your private balance.
        </Text>
      </View>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            label="Deposit"
            onPress={() => setActive('deposit')}
          />
        </View>
        <View style={styles.action}>
          <Button
            label="Withdraw"
            onPress={() => setActive('withdraw')}
            variant="secondary"
          />
        </View>
      </View>
      <FundsSheet active={active} onClose={() => setActive(null)} />
    </View>
  );
}

function FundsSheet({
  active,
  onClose,
}: {
  readonly active: 'deposit' | 'withdraw' | null;
  readonly onClose: () => void;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={active !== null}
    >
      <View style={styles.sheetRoot}>
        <Pressable
          accessibilityLabel="Close funds panel"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.scrim}
        />
        <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.sheetDock}>
          <SafeAreaView accessibilityViewIsModal edges={['bottom']} style={styles.sheet}>
            <View accessibilityElementsHidden style={styles.grabber} />
            <View style={styles.sheetHeader}>
              <PressableScale
                accessibilityLabel="Close"
                accessibilityRole="button"
                hitSlop={12}
                onPress={onClose}
                style={styles.close}
              >
                <MaterialCommunityIcons
                  color={colors.textPrimary}
                  name="close"
                  size={20}
                />
              </PressableScale>
            </View>
            <ScrollView
              contentContainerStyle={styles.sheetContent}
              contentInsetAdjustmentBehavior="never"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {active === 'deposit' ? <PrivateFundingPanel tradingReady /> : null}
              {active === 'withdraw' ? <PrivateWithdrawPanel /> : null}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Position({ position }: { readonly position: PacificaPosition }) {
  return (
    <View style={styles.listItem}>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.subheading}>{position.symbol}</Text>
        <Text selectable style={position.side === 'long' ? styles.long : styles.short}>
          {position.side === 'long' ? 'Long' : 'Short'}
        </Text>
      </View>
      <StatusRow label="Size" value={position.amount} />
      <StatusRow label="Entry price" value={usd(position.entryPrice)} />
      <StatusRow label="Margin" value={usd(position.margin)} />
      <StatusRow label="Funding" value={usd(position.funding)} />
      <StatusRow
        label="Liquidation"
        value={position.liquidationPrice === null ? 'Unavailable' : usd(position.liquidationPrice)}
      />
      <StatusRow label="Margin mode" value={position.marginMode} />
    </View>
  );
}

function usd(value: string): string {
  const [whole = '0', fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return `$${fraction === undefined ? grouped : `${grouped}.${fraction}`}`;
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.lg,
    gap: spacing.xl,
  },
  header: { gap: spacing.xxs },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.bodyCompact, color: colors.textSecondary },
  section: {
    gap: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sectionCopy: { gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  heading: { ...typography.heading, color: colors.textPrimary },
  subheading: { ...typography.label, color: colors.textPrimary },
  list: { gap: spacing.md },
  listItem: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  long: { ...typography.bodyCompact, color: colors.positive },
  short: { ...typography.bodyCompact, color: colors.negative },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
  sheetRoot: { flex: 1 },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
    opacity: 0.72,
  },
  sheetDock: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '88%',
    overflow: 'hidden',
    borderTopLeftRadius: radii.panel,
    borderTopRightRadius: radii.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  grabber: {
    width: 44,
    height: 4,
    alignSelf: 'center',
    marginTop: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
  },
  sheetHeader: {
    minHeight: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
  },
  close: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  sheetContent: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xxl,
  },
});
