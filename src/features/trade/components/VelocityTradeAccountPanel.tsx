import { memo, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { UnderlineTabs, type UnderlineTabOption } from '@/components/ui/UnderlineTabs';
import { StatusRow } from '@/components/ui/StatusRow';
import type { AppConfig } from '@/config/appConfig';
import { amountFromBaseUnits, formatAmountWithCommas } from '@/domain/money/amount';
import { ActivityRow } from '@/features/portfolio/components/ActivityRow';
import { velocityTradeActivityItem } from '@/features/portfolio/components/activityItems';
import type {
  VelocityAccountState,
  VelocityHistoryState,
} from '@/features/portfolio/hooks/useVelocityAccount';
import {
  type VelocityAccountSnapshot,
  type VelocityOpenOrder,
  type VelocityPosition,
} from '@/integrations/perps/velocity/velocityAccount';
import {
  prepareVelocityClose,
  submitVelocityTradePreparation,
  type VelocityTradePreparation,
} from '@/integrations/perps/velocity/velocityTrade';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type AccountTab = 'positions' | 'orders' | 'balance' | 'history';

const TABS: readonly UnderlineTabOption<AccountTab>[] = [
  { id: 'positions', label: 'Positions' },
  { id: 'orders', label: 'Open orders' },
  { id: 'balance', label: 'Balance' },
  { id: 'history', label: 'Trade history' },
];

function VelocityTradeAccountPanelComponent({
  account,
  config,
  history,
  onRefresh,
}: {
  readonly account: VelocityAccountState;
  readonly config: AppConfig;
  readonly history: VelocityHistoryState;
  readonly onRefresh: () => void;
}) {
  const session = useTradingSession();
  const owner = session.status === 'ready' ? session.address : null;
  const [tab, setTab] = useState<AccountTab>('positions');
  const [busyMarket, setBusyMarket] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const prepareClose = async (position: VelocityPosition) => {
    if (owner === null || session.signer === null || busyMarket !== null) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusyMarket(position.marketIndex);
    try {
      const preparation = await prepareVelocityClose({
        marketIndex: position.marketIndex,
        owner,
        programId: config.perps.velocityProgramId,
        publicRpcUrl: config.api.publicRpcUrl,
        rpcUrl: config.api.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
      });
      if (!abort.signal.aborted) showCloseReview(position, preparation);
    } catch (cause) {
      if (!abort.signal.aborted) {
        console.warn('[Perpal Velocity close preparation failed]', safeError(cause));
        publishInAppNotification({
          kind: 'trade', outcome: 'error', title: 'Close unavailable',
          message: userMessage(cause),
        });
      }
    } finally {
      if (!abort.signal.aborted) setBusyMarket(null);
    }
  };

  const showCloseReview = (
    position: VelocityPosition,
    preparation: VelocityTradePreparation,
  ) => {
    if (preparation.kind !== 'velocity' || preparation.plan.action !== 'close') return;
    const closeSide = position.side === 'long' ? 'Sell' : 'Buy';
    Alert.alert(
      `Close ${position.symbol} ${position.side}?`,
      [
        `Reduce-only market close`,
        `Size: ${base(position.baseAssetAmount)} ${position.symbol}`,
        `Action: ${closeSide} to close`,
        `Network fee: ${sol(preparation.plan.feeLamports)} SOL`,
        `Expires: ${new Date(preparation.plan.expiresAtMs).toLocaleTimeString()}`,
      ].join('\n'),
      [
        { text: 'Keep position', style: 'cancel' },
        {
          text: 'Confirm and sign',
          style: 'destructive',
          onPress: () => void submitClose(position, preparation),
        },
      ],
    );
  };

  const submitClose = async (
    position: VelocityPosition,
    preparation: VelocityTradePreparation,
  ) => {
    if (owner === null || session.signer === null) return;
    setBusyMarket(position.marketIndex);
    try {
      const result = await submitVelocityTradePreparation({
        owner,
        preparation,
        rpcUrl: config.api.rpcUrl,
        signer: session.signer,
      });
      if (result.status !== 'confirmed') {
        publishInAppNotification({
          kind: 'trade', outcome: 'info', title: 'Close submitted',
          message: 'The reduce-only close is still confirming.',
        });
        return;
      }
      publishInAppNotification({
        kind: 'trade',
        outcome: 'success',
        title: `${position.symbol} position closed`,
        message: 'The reduce-only market close confirmed.',
      });
      onRefresh();
    } catch (cause) {
      console.warn('[Perpal Velocity close submission failed]', safeError(cause));
      publishInAppNotification({
        kind: 'trade', outcome: 'error', title: 'Close failed', message: userMessage(cause),
      });
    } finally {
      setBusyMarket(null);
    }
  };

  return (
    <View style={styles.shell}>
      <UnderlineTabs onSelect={setTab} options={TABS} selectedId={tab} />
      {owner === null || account.status === 'loading' ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>Loading your trades…</Text>
      ) : account.status === 'not-created' ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>No Velocity account yet.</Text>
      ) : account.snapshot === null ? (
        <View style={styles.errorRow}>
          <Text accessibilityRole="alert" style={styles.error}>Velocity account refresh failed.</Text>
          <Pressable accessibilityRole="button" onPress={onRefresh} style={styles.retry}>
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {account.status === 'stale' ? (
            <Text accessibilityRole="alert" style={styles.stale}>Showing the last confirmed account state.</Text>
          ) : null}
          {tab === 'positions' ? (
            <Positions
              busyMarket={busyMarket}
              onClose={(position) => void prepareClose(position)}
              positions={account.snapshot.positions}
            />
          ) : null}
          {tab === 'orders' ? <Orders orders={account.snapshot.orders} /> : null}
          {tab === 'balance' ? <Balance snapshot={account.snapshot} /> : null}
          {tab === 'history' ? <TradeHistory history={history} onRefresh={onRefresh} /> : null}
        </>
      )}
    </View>
  );
}

export const VelocityTradeAccountPanel = memo(VelocityTradeAccountPanelComponent);

function Positions(props: {
  readonly busyMarket: number | null;
  readonly onClose: (position: VelocityPosition) => void;
  readonly positions: readonly VelocityPosition[];
}) {
  if (props.positions.length === 0) return <Empty message="No open positions." />;
  return (
    <View style={styles.list}>
      {props.positions.map((position) => (
        <View key={position.marketIndex} style={styles.item}>
          <View style={styles.itemHeader}>
            <View style={styles.positionTitle}>
              <Text style={styles.itemTitle}>{position.symbol}-PERP</Text>
              <Text style={position.side === 'long' ? styles.long : styles.short}>
                {position.side.toUpperCase()}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={`Close ${position.symbol} ${position.side} position`}
              accessibilityRole="button"
              disabled={props.busyMarket !== null}
              onPress={() => props.onClose(position)}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            >
              <Text style={styles.closeLabel}>
                {props.busyMarket === position.marketIndex ? 'Preparing…' : 'Close'}
              </Text>
            </Pressable>
          </View>
          <StatusRow label="Size" value={`${base(position.baseAssetAmount)} ${position.symbol}`} />
          <StatusRow label="Entry / mark" value={`$${quote(position.entryPriceBaseUnits)} / $${quote(position.markPriceBaseUnits)}`} />
          <StatusRow
            label="Unrealized PnL"
            tone={position.pnlBaseUnits > 0n
              ? 'positive'
              : position.pnlBaseUnits < 0n ? 'negative' : 'plain'}
            value={`${position.pnlBaseUnits >= 0n ? '+' : ''}$${quote(position.pnlBaseUnits)}`}
          />
          <StatusRow label="Liquidation" value={position.liquidationPriceBaseUnits === null ? '--' : `$${quote(position.liquidationPriceBaseUnits)}`} />
          <StatusRow label="Margin" value={position.marginMode} />
        </View>
      ))}
    </View>
  );
}

function Orders({ orders }: { readonly orders: readonly VelocityOpenOrder[] }) {
  if (orders.length === 0) return <Empty message="No open orders." />;
  return (
    <View style={styles.list}>
      {orders.map((order) => (
        <View key={order.orderId} style={styles.item}>
          <View style={styles.itemHeader}>
            <Text style={styles.itemTitle}>{order.symbol}-PERP</Text>
            <Text style={order.side === 'long' ? styles.long : styles.short}>
              {order.side === 'long' ? 'BUY' : 'SELL'}
            </Text>
          </View>
          <StatusRow label="Type" value={`${order.orderType}${order.reduceOnly ? ' · reduce only' : ''}`} />
          <StatusRow label="Remaining" value={`${base(order.remainingBaseUnits)} ${order.symbol}`} />
          <StatusRow label="Price" value={order.priceBaseUnits === null ? 'Market' : `$${quote(order.priceBaseUnits)}`} />
        </View>
      ))}
    </View>
  );
}

function Balance({ snapshot }: { readonly snapshot: VelocityAccountSnapshot }) {
  return (
    <View style={styles.balance}>
      <StatusRow label="Account equity" value={`$${quote(snapshot.equityBaseUnits)}`} />
      <StatusRow label="Available to trade" value={`$${quote(snapshot.freeCollateralBaseUnits)}`} />
    </View>
  );
}

function TradeHistory({
  history,
  onRefresh,
}: {
  readonly history: VelocityHistoryState;
  readonly onRefresh: () => void;
}) {
  if (history.status === 'loading' || history.status === 'idle') {
    return <Empty message="Loading trade history…" />;
  }
  if (history.status === 'error' || history.data === null) {
    return (
      <View style={styles.errorRow}>
        <Text accessibilityRole="alert" style={styles.error}>Trade history refresh failed.</Text>
        <Pressable accessibilityRole="button" onPress={onRefresh} style={styles.retry}>
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (history.data.trades.length === 0) return <Empty message="No executed trades." />;
  const items = history.data.trades.slice(0, 20).map(velocityTradeActivityItem);
  return (
    <View style={styles.list}>
      {history.status === 'stale' ? (
        <Text accessibilityRole="alert" style={styles.stale}>
          Showing confirmed history while the latest refresh retries.
        </Text>
      ) : null}
      {items.map((item, index) => (
        <ActivityRow item={item} key={item.id} last={index === items.length - 1} />
      ))}
    </View>
  );
}

function Empty({ message }: { readonly message: string }) {
  return <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text>;
}

function base(value: bigint): string {
  return formatAmountWithCommas(amountFromBaseUnits(value < 0n ? -value : value, 9));
}

function quote(value: bigint): string {
  return formatAmountWithCommas(amountFromBaseUnits(value, 6));
}

function sol(value: bigint): string {
  return formatAmountWithCommas(amountFromBaseUnits(value, 9));
}

function userMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  return message.length > 0 ? message : 'The Velocity action could not be completed.';
}

function safeError(cause: unknown): { readonly message: string; readonly name: string } {
  return {
    message: cause instanceof Error ? cause.message : 'Unknown error',
    name: cause instanceof Error ? cause.name : typeof cause,
  };
}

const styles = StyleSheet.create({
  shell: { gap: spacing.sm, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface },
  status: { ...typography.bodyCompact, paddingVertical: spacing.lg, textAlign: 'center', color: colors.textMuted },
  stale: { ...typography.caption, color: colors.textSecondary },
  errorRow: { gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.lg },
  error: { ...typography.bodyCompact, textAlign: 'center', color: colors.negative },
  retry: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm },
  retryLabel: { ...typography.label, color: colors.textPrimary },
  list: { gap: spacing.sm },
  item: { gap: spacing.xs, padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.background },
  itemHeader: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  positionTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  itemTitle: { ...typography.label, color: colors.textPrimary },
  long: { ...typography.bodyCompact, color: colors.positive, fontVariant: ['tabular-nums'] },
  short: { ...typography.bodyCompact, color: colors.negative, fontVariant: ['tabular-nums'] },
  close: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.negative, borderRadius: radii.sm },
  closeLabel: { ...typography.caption, color: colors.negative },
  pressed: { opacity: 0.7 },
  balance: { gap: spacing.sm, paddingVertical: spacing.xs },
});
