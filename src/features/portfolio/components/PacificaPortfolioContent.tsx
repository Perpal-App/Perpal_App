import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { StatusRow, StatusRowSkeleton } from '@/components/ui/StatusRow';
import { readAppConfig } from '@/config/appConfig';
import { amountFromBaseUnits, formatDetailedUsd } from '@/domain/money/amount';
import type { WalletBalance, WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { PrivateFundingPanel } from '@/features/account/private-funding';
import { AccountOverviewCard } from '@/features/home/components/AccountOverviewCard';
import { PrivateWithdrawPanel } from '@/features/portfolio/components/PrivateWithdrawPanel';
import { cancelPacificaOrder } from '@/integrations/perps/pacifica/pacificaOrder';
import type {
  PacificaOpenOrder,
  PacificaPortfolioSnapshot,
  PacificaPosition,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { colors, layout, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Props = {
  readonly balances: WalletBalances | null;
  readonly balancesPending: boolean;
  readonly balancesUnavailable: boolean;
  readonly portfolioPending: boolean;
  readonly portfolioUnavailable: boolean;
  readonly privateAddress: string;
  readonly publicAddress: string | null;
  readonly snapshot: PacificaPortfolioSnapshot | null;
};

export function PacificaPortfolioContent({
  balances,
  balancesPending,
  balancesUnavailable,
  portfolioPending,
  portfolioUnavailable,
  privateAddress,
  publicAddress,
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
          <Text selectable style={styles.subtitle}>Public and private account overview</Text>
        </View>

        <AccountOverviewCard
          balances={balances}
          balancesPending={balancesPending}
          portfolio={snapshot}
          portfolioPending={portfolioPending}
        />

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Accounts</Text>
          <AccountBlock
            address={publicAddress}
            balance={balances?.publicWallet ?? null}
            label="Public wallet (M)"
            pending={balancesPending}
            unavailable={balancesUnavailable}
          />
          <AccountBlock
            address={privateAddress}
            balance={balances?.privateWallet ?? null}
            label="Private wallet (T)"
            pending={balancesPending}
            unavailable={balancesUnavailable}
          />
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.heading}>Trading</Text>
          <TradingSummary
            pending={portfolioPending}
            snapshot={snapshot}
            unavailable={portfolioUnavailable}
          />
          {snapshot?.positions.length ? (
            <View style={styles.list}>
              <Text accessibilityRole="header" style={styles.subheading}>Open positions</Text>
              {snapshot.positions.map((position) => (
                <Position key={`${position.symbol}:${position.side}`} position={position} />
              ))}
            </View>
          ) : snapshot !== null && !portfolioPending ? (
            <State
              message="Closed positions release their collateral into your private trading balance."
              title="No open positions"
            />
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

        <Funds />
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
            variant={active === 'deposit' ? 'primary' : 'secondary'}
          />
        </View>
        <View style={styles.action}>
          <Button
            label="Withdraw"
            onPress={() => setActive('withdraw')}
            variant={active === 'withdraw' ? 'primary' : 'secondary'}
          />
        </View>
      </View>
      {active === 'deposit' ? <PrivateFundingPanel tradingReady /> : null}
      {active === 'withdraw' ? <PrivateWithdrawPanel /> : null}
    </View>
  );
}

function AccountBlock({
  address,
  balance,
  label,
  pending,
  unavailable,
}: {
  readonly address: string | null;
  readonly balance: WalletBalance | null;
  readonly label: string;
  readonly pending: boolean;
  readonly unavailable: boolean;
}) {
  return (
    <View style={styles.account}>
      <Text accessibilityRole="header" style={styles.subheading}>{label}</Text>
      <StatusRow label="Address" selectable value={address ?? 'Unavailable'} />
      {pending && balance === null ? (
        <StatusRowSkeleton labelWidth={86} valueWidth={74} />
      ) : (
        <StatusRow
          label="Wallet value"
          value={unavailable ? 'Unavailable' : walletValue(balance)}
        />
      )}
      {balance?.valuation && balance.valuation.unpricedAssetCount > 0 ? (
        <Text selectable style={styles.note}>
          {balance.valuation.unpricedAssetCount} asset value could not be priced.
        </Text>
      ) : null}
    </View>
  );
}

function TradingSummary({
  pending,
  snapshot,
  unavailable,
}: {
  readonly pending: boolean;
  readonly snapshot: PacificaPortfolioSnapshot | null;
  readonly unavailable: boolean;
}) {
  if (pending && snapshot === null) {
    return (
      <View accessibilityLabel="Loading trading balances" accessibilityRole="progressbar" style={styles.summary}>
        <StatusRowSkeleton labelWidth={124} valueWidth={68} />
        <StatusRowSkeleton labelWidth={148} valueWidth={74} />
        <StatusRowSkeleton labelWidth={92} valueWidth={62} />
      </View>
    );
  }

  if (unavailable || snapshot === null) {
    return (
      <Text accessibilityRole="alert" selectable style={styles.note}>
        Trading balances are temporarily unavailable. Wallet balances remain visible above.
      </Text>
    );
  }

  return (
    <View style={styles.summary}>
      <StatusRow label="Available to trade" value={usd(snapshot.availableToSpend)} />
      <StatusRow label="Closed funds available" value={usd(snapshot.availableToWithdraw)} />
      <StatusRow label="Margin in use" value={usd(snapshot.totalMarginUsed)} />
      <StatusRow label="Open orders" value={String(snapshot.orders.length)} />
    </View>
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

function State({ title, message }: { readonly title: string; readonly message: string }) {
  return (
    <View style={styles.state}>
      <Text accessibilityRole="header" style={styles.subheading}>{title}</Text>
      <Text selectable style={styles.note}>{message}</Text>
    </View>
  );
}

function walletValue(balance: WalletBalance | null): string {
  return balance?.valuation === null || balance === null
    ? 'Unavailable'
    : formatDetailedUsd(amountFromBaseUnits(balance.valuation.usdBaseUnits, 6));
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
  account: { gap: spacing.sm },
  summary: { gap: spacing.md },
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
  state: { gap: spacing.sm, paddingVertical: spacing.sm },
});
