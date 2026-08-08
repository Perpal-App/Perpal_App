import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig } from '@/config/appConfig';
import { PrivateWithdrawPanel } from '@/features/portfolio/components/PrivateWithdrawPanel';
import { cancelPacificaOrder } from '@/integrations/perps/pacifica/pacificaOrder';
import type {
  PacificaOpenOrder,
  PacificaPortfolioSnapshot,
  PacificaPosition,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function PacificaPortfolioContent({ snapshot }: { readonly snapshot: PacificaPortfolioSnapshot }) {
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
          }).catch((cause) => Alert.alert(
            'Cancellation failed',
            cause instanceof Error ? cause.message : 'Pacifica cancellation failed.',
          ));
        },
      },
    ],
  );

  return (
    <AppScreen>
      <View style={styles.container}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>Portfolio</Text>
          <Text style={styles.subtitle}>Pacifica · private wallet T</Text>
        </View>
        <View style={styles.summary}>
          <StatusRow label="Account balance" value={usd(snapshot.balance)} />
          <StatusRow label="Account equity" value={usd(snapshot.accountEquity)} />
          <StatusRow label="Available to trade" value={usd(snapshot.availableToSpend)} />
          <StatusRow label="Available to withdraw" value={usd(snapshot.availableToWithdraw)} />
          <StatusRow label="Margin used" value={usd(snapshot.totalMarginUsed)} />
          <StatusRow label="Open orders" value={String(snapshot.orders.length)} />
        </View>
        {!snapshot.initialized ? (
          <State title="No collateral allocated" message="Your first trade automatically deposits the required USDC from private wallet T." />
        ) : snapshot.positions.length === 0 ? (
          <State title="No open positions" message="Pacifica has no open perpetual position for private wallet T." />
        ) : (
          <View style={styles.stack}>
            {snapshot.positions.map((position) => <Position key={`${position.symbol}:${position.side}`} position={position} />)}
          </View>
        )}
        {snapshot.orders.length > 0 ? (
          <View style={styles.stack}>
            <Text accessibilityRole="header" style={styles.heading}>Open orders</Text>
            {snapshot.orders.map((order) => (
              <View key={order.orderId} style={styles.panel}>
                <StatusRow label="Market" value={order.symbol} />
                <StatusRow label="Side" value={order.side === 'bid' ? 'Buy / long' : 'Sell / short'} />
                <StatusRow label="Amount" value={order.initialAmount} />
                <StatusRow label="Price" value={usd(order.price)} />
                <Button label="Cancel order" onPress={() => cancel(order)} variant="secondary" />
              </View>
            ))}
          </View>
        ) : null}
        {snapshot.initialized ? <PrivateWithdrawPanel /> : null}
      </View>
    </AppScreen>
  );
}

function Position({ position }: { readonly position: PacificaPosition }) {
  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={styles.heading}>{position.symbol}</Text>
        <Text style={position.side === 'long' ? styles.long : styles.short}>{position.side}</Text>
      </View>
      <StatusRow label="Size" value={position.amount} />
      <StatusRow label="Entry price" value={usd(position.entryPrice)} />
      <StatusRow label="Margin" value={usd(position.margin)} />
      <StatusRow label="Funding" value={usd(position.funding)} />
      <StatusRow label="Liquidation" value={position.liquidationPrice === null ? 'Unavailable' : usd(position.liquidationPrice)} />
      <StatusRow label="Margin mode" value={position.marginMode} />
    </View>
  );
}

function State({ title, message }: { readonly title: string; readonly message: string }) {
  return <View style={styles.state}><Text style={styles.heading}>{title}</Text><Text style={styles.subtitle}>{message}</Text></View>;
}

function usd(value: string): string {
  const [whole = '0', fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return `$${fraction === undefined ? grouped : `${grouped}.${fraction}`}`;
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingHorizontal: layout.screenPadding, paddingVertical: spacing.lg, gap: spacing.lg },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.bodyCompact, color: colors.textSecondary },
  summary: { gap: spacing.md, paddingBottom: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  stack: { gap: spacing.md },
  panel: { gap: spacing.md, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  heading: { ...typography.heading, color: colors.textPrimary },
  long: { ...typography.bodyCompact, color: colors.positive },
  short: { ...typography.bodyCompact, color: colors.negative },
  state: { gap: spacing.sm, paddingVertical: spacing.xl },
});
