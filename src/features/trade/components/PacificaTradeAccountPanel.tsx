import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { UnderlineTabs, type UnderlineTabOption } from '@/components/ui/UnderlineTabs';
import { StatusRow } from '@/components/ui/StatusRow';
import { formatAmountWithCommas, parseAmount } from '@/domain/money/amount';
import {
  fetchPacificaActivity,
  mergePacificaActivity,
  type PacificaActivity,
  type PacificaOrderActivity,
  type PacificaTradeActivity,
} from '@/integrations/perps/pacifica/pacificaActivity';
import { publishPacificaActivitySnapshot } from '@/integrations/perps/pacifica/pacificaActivityStore';
import {
  isPacificaRateLimited,
  pacificaRetryDelay,
  PacificaApiError,
} from '@/integrations/perps/pacifica/pacificaApi';
import {
  cancelPacificaOrder,
  PacificaCommandPendingError,
} from '@/integrations/perps/pacifica/pacificaOrder';
import {
  fetchFreshPacificaPortfolio,
  fetchPacificaPortfolio,
  type PacificaOpenOrder,
  type PacificaPortfolioSnapshot,
  type PacificaPosition,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
} from '@/storage/inAppNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type AccountTab = 'positions' | 'balance' | 'orders' | 'history';
type AccountState = {
  readonly activity: PacificaActivity | null;
  readonly portfolio: PacificaPortfolioSnapshot | null;
  readonly status: 'error' | 'loading' | 'ready' | 'stale';
};

const TABS: readonly UnderlineTabOption<AccountTab>[] = [
  { id: 'positions', label: 'Positions' },
  { id: 'balance', label: 'Balance' },
  { id: 'orders', label: 'Open orders' },
  { id: 'history', label: 'History' },
];
const REFRESH_INTERVAL_MS = 5_000;
const MAX_RETRY_INTERVAL_MS = 60_000;

export function PacificaTradeAccountPanel({ apiOrigin }: { readonly apiOrigin: string }) {
  const session = useTradingSession();
  const account = session.status === 'ready' ? session.address : null;
  const accountData = useTradeAccountData(apiOrigin, account);
  const [tab, setTab] = useState<AccountTab>('positions');
  const [cancelling, setCancelling] = useState<number | null>(null);
  const portfolio = accountData.state.portfolio;

  const cancel = (order: PacificaOpenOrder) => Alert.alert(
    `Cancel ${order.symbol} order?`,
    `${order.side === 'bid' ? 'Buy' : 'Sell'} ${order.initialAmount} at $${decimal(order.price)}.`,
    [
      { text: 'Keep order', style: 'cancel' },
      {
        text: 'Confirm and sign',
        style: 'destructive',
        onPress: () => {
          if (account === null || session.signer === null) return;
          const scopeToken = captureInAppNotificationScope();
          setCancelling(order.orderId);
          void cancelPacificaOrder({
            account,
            apiOrigin,
            clientOrderId: order.clientOrderId,
            orderId: order.orderId,
            signer: session.signer,
            symbol: order.symbol,
          }).then((result) => {
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
            accountData.refresh();
          }).catch((cause) => {
            if (__DEV__) console.error('[Perpal Pacifica order cancellation failed]', {
              error: cause instanceof Error ? cause.message : typeof cause,
            });
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
          }).finally(() => setCancelling(null));
        },
      },
    ],
  );

  return (
    <View style={styles.shell}>
      <UnderlineTabs onSelect={setTab} options={TABS} selectedId={tab} />
      {account === null ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>Preparing private trading…</Text>
      ) : accountData.state.status === 'loading' ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>Loading trading account…</Text>
      ) : portfolio === null ? (
        <View style={styles.errorRow}>
          <Text accessibilityRole="alert" selectable style={styles.error}>Trading account refresh failed.</Text>
          <Pressable accessibilityRole="button" onPress={accountData.refresh} style={styles.retry}>
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {accountData.state.status === 'stale' ? (
            <Text accessibilityRole="alert" style={styles.stale}>Showing the last confirmed account snapshot.</Text>
          ) : null}
          {tab === 'positions' ? <Positions positions={portfolio.positions} /> : null}
          {tab === 'balance' ? <Balance portfolio={portfolio} /> : null}
          {tab === 'orders' ? (
            <Orders cancelling={cancelling} onCancel={cancel} orders={portfolio.orders} />
          ) : null}
          {tab === 'history' ? <TradeHistory activity={accountData.state.activity} /> : null}
        </>
      )}
    </View>
  );
}

function Positions({ positions }: { readonly positions: readonly PacificaPosition[] }) {
  if (positions.length === 0) return <Empty message="No open positions." />;
  return (
    <View style={styles.list}>
      {positions.map((position) => (
        <View key={`${position.symbol}:${position.side}`} style={styles.item}>
          <View style={styles.itemHeader}>
            <Text style={styles.itemTitle}>{position.symbol}</Text>
            <Text style={position.side === 'long' ? styles.long : styles.short}>{position.side.toUpperCase()}</Text>
          </View>
          <StatusRow label="Size" value={decimal(position.amount)} />
          <StatusRow label="Entry" value={`$${decimal(position.entryPrice)}`} />
          <StatusRow label="Margin" value={`$${decimal(position.margin)} · ${position.marginMode}`} />
          <StatusRow label="Liquidation" value={position.liquidationPrice === null ? '--' : `$${decimal(position.liquidationPrice)}`} />
        </View>
      ))}
    </View>
  );
}

function Balance({ portfolio }: { readonly portfolio: PacificaPortfolioSnapshot }) {
  return (
    <View style={styles.balance}>
      <StatusRow label="Account equity" value={`$${decimal(portfolio.accountEquity)}`} />
      <StatusRow label="Available to trade" value={`$${decimal(portfolio.availableToSpend)}`} />
      <StatusRow label="Margin in use" value={`$${decimal(portfolio.totalMarginUsed)}`} />
      <StatusRow label="Available to withdraw" value={`$${decimal(portfolio.availableToWithdraw)}`} />
    </View>
  );
}

function Orders(props: {
  readonly cancelling: number | null;
  readonly onCancel: (order: PacificaOpenOrder) => void;
  readonly orders: readonly PacificaOpenOrder[];
}) {
  if (props.orders.length === 0) return <Empty message="No open orders." />;
  return (
    <View style={styles.list}>
      {props.orders.map((order) => (
        <View key={order.orderId} style={styles.item}>
          <View style={styles.itemHeader}>
            <Text style={styles.itemTitle}>{order.symbol}</Text>
            <Pressable accessibilityRole="button" disabled={props.cancelling !== null} onPress={() => props.onCancel(order)} style={styles.cancel}>
              <Text style={styles.cancelLabel}>{props.cancelling === order.orderId ? 'Cancelling…' : 'Cancel'}</Text>
            </Pressable>
          </View>
          <StatusRow label="Side" value={order.side === 'bid' ? 'Buy' : 'Sell'} />
          <StatusRow label="Price" value={`$${decimal(order.price)}`} />
          <StatusRow label="Filled" value={`${decimal(order.filledAmount)} / ${decimal(order.initialAmount)}`} />
        </View>
      ))}
    </View>
  );
}

function TradeHistory({ activity }: { readonly activity: PacificaActivity | null }) {
  const fillOrderIds = new Set(activity?.trades.map((trade) => trade.orderId) ?? []);
  const history = [
    ...(activity?.trades.map((trade) => ({ kind: 'fill' as const, time: trade.createdAtMs, trade })) ?? []),
    ...(activity?.orders
      .filter((order) => order.orderStatus !== 'filled' || !fillOrderIds.has(order.orderId))
      .map((order) => ({ kind: 'order' as const, order, time: order.updatedAtMs })) ?? []),
  ].sort((left, right) => right.time - left.time).slice(0, 12);

  if (history.length === 0) return <Empty message="No Pacifica order activity." />;
  return (
    <View style={styles.list}>
      {history.map((item) => item.kind === 'fill'
        ? <TradeRow key={`fill:${item.trade.historyId}`} trade={item.trade} />
        : <OrderHistoryRow key={`order:${item.order.orderId}`} order={item.order} />)}
    </View>
  );
}

function TradeRow({ trade }: { readonly trade: PacificaTradeActivity }) {
  const positive = !trade.pnl.startsWith('-');
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyText}>
        <Text style={styles.itemTitle}>{trade.symbol} · {trade.side.replace('_', ' ')}</Text>
        <Text selectable style={styles.detail}>{decimal(trade.amount)} at ${decimal(trade.price)} · Fee ${decimal(trade.fee)}</Text>
      </View>
      <View style={styles.historyValue}>
        <Text selectable style={positive ? styles.long : styles.short}>{positive ? '+' : ''}${decimal(trade.pnl)}</Text>
        <Text style={styles.detail}>{new Date(trade.createdAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
      </View>
    </View>
  );
}

function OrderHistoryRow({ order }: { readonly order: PacificaOrderActivity }) {
  const price = !zero(order.averageFilledPrice)
    ? order.averageFilledPrice
    : !zero(order.initialPrice) ? order.initialPrice : null;
  const statusStyle = order.orderStatus === 'rejected'
    ? styles.short
    : order.orderStatus === 'filled' ? styles.long : styles.detail;
  return (
    <View style={styles.historyRow}>
      <View style={styles.historyText}>
        <Text style={styles.itemTitle}>
          {order.symbol} · {order.side === 'bid' ? 'buy' : 'sell'} {order.orderType.split('_').join(' ')}
        </Text>
        <Text selectable style={styles.detail}>
          {decimal(order.filledAmount)} / {decimal(order.amount)} filled
          {price === null ? '' : ` at $${decimal(price)}`}
          {order.reduceOnly ? ' · Reduce only' : ''}
        </Text>
      </View>
      <View style={styles.historyValue}>
        <Text style={statusStyle}>{order.orderStatus.split('_').join(' ')}</Text>
        <Text style={styles.detail}>
          {new Date(order.updatedAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </View>
  );
}

function Empty({ message }: { readonly message: string }) {
  return <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text>;
}

function useTradeAccountData(apiOrigin: string, account: string | null) {
  const [state, setState] = useState<AccountState>({ activity: null, portfolio: null, status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const hasData = useRef(false);
  const activityData = useRef<PacificaActivity | null>(null);
  const forceNetwork = useRef(false);
  const refresh = useCallback(() => {
    forceNetwork.current = true;
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    hasData.current = false;
    activityData.current = null;
    setState({ activity: null, portfolio: null, status: 'loading' });
  }, [account, apiOrigin]);

  useFocusEffect(useCallback(() => {
    if (account === null || apiOrigin.length === 0) return undefined;
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      let nextRefreshMs = REFRESH_INTERVAL_MS;
      try {
        const previousActivity = activityData.current;
        const network = forceNetwork.current;
        forceNetwork.current = false;
        const [portfolio, activity] = await Promise.all([
          (network ? fetchFreshPacificaPortfolio : fetchPacificaPortfolio)(
            apiOrigin,
            account,
            controller.signal,
          ),
          fetchPacificaActivity(
            apiOrigin,
            account,
            controller.signal,
            previousActivity === null || previousActivity.incomplete ? 'backfill' : 'latest',
            network ? 'network' : 'cached',
          ),
        ]);
        if (active) {
          const mergedActivity = previousActivity === null
            ? activity
            : mergePacificaActivity(previousActivity, activity);
          consecutiveFailures = mergedActivity.incomplete ? consecutiveFailures + 1 : 0;
          if (mergedActivity.incomplete) {
            nextRefreshMs = pacificaRetryDelay(
              null,
              consecutiveFailures,
              REFRESH_INTERVAL_MS,
              MAX_RETRY_INTERVAL_MS,
            );
          }
          hasData.current = true;
          activityData.current = mergedActivity;
          publishPacificaActivitySnapshot({
            account,
            activity: mergedActivity,
            apiOrigin,
          });
          setState({
            activity: mergedActivity,
            portfolio,
            status: mergedActivity.incomplete ? 'stale' : 'ready',
          });
        }
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          consecutiveFailures += 1;
          nextRefreshMs = pacificaRetryDelay(
            cause,
            consecutiveFailures,
            REFRESH_INTERVAL_MS,
            MAX_RETRY_INTERVAL_MS,
          );
          if (__DEV__ && !isPacificaRateLimited(cause)) {
            console.warn('[Perpal Pacifica trade account refresh failed]',
              cause instanceof PacificaApiError
                ? {
                    errorCode: cause.code,
                    errorName: cause.name,
                    requestPath: cause.requestPath,
                    status: cause.status,
                  }
                : { errorName: cause instanceof Error ? cause.name : typeof cause },
            );
          }
          setState((current) => ({
            ...current,
            status: hasData.current ? 'stale' : isPacificaRateLimited(cause) ? 'loading' : 'error',
          }));
        }
      } finally {
        if (active) timer = setTimeout(() => void load(), nextRefreshMs);
      }
    };
    void load();
    return () => {
      active = false;
      controller?.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [account, apiOrigin, refreshKey]));

  return { refresh, state };
}

function decimal(value: string): string {
  try { return formatAmountWithCommas(parseAmount(value, 10)); } catch { return value; }
}

function zero(value: string): boolean {
  return /^-?0+(?:\.0+)?$/u.test(value);
}

const styles = StyleSheet.create({
  shell: { gap: spacing.sm, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface },
  status: { ...typography.bodyCompact, paddingVertical: spacing.lg, textAlign: 'center', color: colors.textMuted },
  errorRow: { gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.lg },
  error: { ...typography.bodyCompact, textAlign: 'center', color: colors.negative },
  stale: { ...typography.caption, color: colors.textSecondary },
  retry: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm },
  retryLabel: { ...typography.label, color: colors.textPrimary },
  list: { gap: spacing.sm },
  item: { gap: spacing.xs, padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.background },
  itemHeader: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  itemTitle: { ...typography.label, color: colors.textPrimary },
  long: { ...typography.bodyCompact, color: colors.positive, fontVariant: ['tabular-nums'] },
  short: { ...typography.bodyCompact, color: colors.negative, fontVariant: ['tabular-nums'] },
  balance: { gap: spacing.sm, paddingVertical: spacing.xs },
  cancel: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.negative, borderRadius: radii.sm },
  cancelLabel: { ...typography.caption, color: colors.negative },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  historyText: { flex: 1, minWidth: 0, gap: spacing.xxs },
  historyValue: { alignItems: 'flex-end', gap: spacing.xxs },
  detail: { ...typography.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
});
