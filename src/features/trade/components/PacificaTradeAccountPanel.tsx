import { useCallback, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { UnderlineTabs, type UnderlineTabOption } from '@/components/ui/UnderlineTabs';
import { formatAmountWithCommas, parseAmount } from '@/domain/money/amount';
import type {
  PacificaActivity,
  PacificaOrderActivity,
  PacificaTradeActivity,
} from '@/integrations/perps/pacifica/pacificaActivity';
import {
  readPacificaActivitySnapshot,
  subscribePacificaActivitySnapshot,
  type PacificaActivitySnapshot,
} from '@/integrations/perps/pacifica/pacificaActivityStore';
import type {
  PacificaPortfolioSnapshot,
  PacificaPosition,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import { refreshPacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolioStore';
import { PositionCard } from '@/features/trade/components/PositionCard';
import { useLivePositions } from '@/features/trade/hooks/useLivePositions';
import { usePacificaAccountSnapshot } from '@/features/trade/hooks/usePacificaAccountSnapshot';
import { positionKey, type PositionCloser } from '@/features/trade/hooks/usePacificaPositionClose';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type AccountTab = 'positions' | 'history';
type AccountState = {
  readonly activity: PacificaActivity | null;
  readonly portfolio: PacificaPortfolioSnapshot | null;
  readonly status: 'error' | 'loading' | 'ready' | 'stale';
};

const EMPTY_ACTIVITY: PacificaActivitySnapshot = {
  data: null,
  status: 'loading',
  updatedAtMs: 0,
};

const TABS: readonly UnderlineTabOption<AccountTab>[] = [
  { id: 'positions', label: 'Positions' },
  { id: 'history', label: 'History' },
];

/**
 * The account, as the market screen shows it: its open positions and its recent history, nothing more.
 * Balances and open orders live on the portfolio, where orders are also cancelled.
 *
 * No container of its own. The tabs sit on the page, and each position card stands on the page as the
 * one object it is, rather than as a card inside a panel.
 */
export function PacificaTradeAccountPanel({
  apiOrigin,
  assetOrigin,
  closer,
  wsOrigin,
}: {
  readonly apiOrigin: string;
  /** For the market catalog the positions are shown against. */
  readonly assetOrigin: string;
  /** The screen's close control, shared with the chart so one close at a time covers both. */
  readonly closer: PositionCloser;
  /** For the live prices the positions are valued at. */
  readonly wsOrigin: string;
}) {
  const session = useTradingSession();
  const account = session.status === 'ready' ? session.address : null;
  const accountData = useTradeAccountData(apiOrigin, account);
  const [tab, setTab] = useState<AccountTab>('positions');
  const portfolio = accountData.state.portfolio;

  return (
    <View style={styles.section}>
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
          {tab === 'positions' ? (
            <Positions
              apiOrigin={apiOrigin}
              assetOrigin={assetOrigin}
              closing={closer.closing}
              onClose={closer.close}
              positions={portfolio.positions}
              wsOrigin={wsOrigin}
            />
          ) : (
            <TradeHistory activity={accountData.state.activity} />
          )}
        </>
      )}
    </View>
  );
}

/**
 * The account's open positions on the portfolio's own card, in its trade form: each fact in a box of its
 * own, and only what a decision about the position reads. Valued live here rather than in the panel, so a
 * price tick redraws the cards and not the tabs around them.
 */
function Positions({
  apiOrigin,
  assetOrigin,
  closing,
  onClose,
  positions,
  wsOrigin,
}: {
  readonly apiOrigin: string;
  readonly assetOrigin: string;
  /** The position a close is under way for, by `positionKey`, which disables every Close until it ends. */
  readonly closing: string | null;
  readonly onClose: (position: PacificaPosition) => void;
  readonly positions: readonly PacificaPosition[];
  readonly wsOrigin: string;
}) {
  const live = useLivePositions({ apiOrigin, assetOrigin, positions, wsOrigin });
  if (positions.length === 0) return <Empty message="No open positions." />;
  return (
    <View style={styles.list}>
      {positions.map((position) => {
        const key = positionKey(position);
        return (
          <PositionCard
            key={key}
            {...live(position)}
            closeDisabled={closing !== null}
            closing={closing === key}
            facts="trade"
            onClose={() => onClose(position)}
            position={position}
          />
        );
      })}
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
  const portfolio = usePacificaAccountSnapshot(apiOrigin, account);

  const subscribeActivity = useCallback((listener: () => void) => (
    account === null ? () => undefined : subscribePacificaActivitySnapshot(apiOrigin, account, listener)
  ), [account, apiOrigin]);
  const readActivity = useCallback(() => (
    account === null ? EMPTY_ACTIVITY : readPacificaActivitySnapshot(apiOrigin, account)
  ), [account, apiOrigin]);
  const activity = useSyncExternalStore(subscribeActivity, readActivity, readActivity);

  // The root lifecycle monitor owns polling/backfill. This panel only subscribes, eliminating a second
  // six-endpoint five-second loop while a market is open. Explicit Retry refreshes the account snapshot;
  // activity remains independently maintained by the root owner.
  const refresh = useCallback(() => {
    if (account === null) return;
    void refreshPacificaPortfolioSnapshot({
      account,
      apiOrigin,
      forceNetwork: true,
    }).catch(() => undefined);
  }, [account, apiOrigin]);

  return {
    refresh,
    state: {
      activity: activity.data,
      portfolio: portfolio.data,
      status: portfolio.status,
    } satisfies AccountState,
  };
}

function decimal(value: string): string {
  try { return formatAmountWithCommas(parseAmount(value, 10)); } catch { return value; }
}

function zero(value: string): boolean {
  return /^-?0+(?:\.0+)?$/u.test(value);
}

const styles = StyleSheet.create({
  // Tabs and content straight on the page: no fill, rim or inset of its own.
  section: { gap: spacing.sm },
  status: { ...typography.bodyCompact, paddingVertical: spacing.lg, textAlign: 'center', color: colors.textMuted },
  errorRow: { gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.lg },
  error: { ...typography.bodyCompact, textAlign: 'center', color: colors.negative },
  stale: { ...typography.caption, color: colors.textSecondary },
  retry: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm },
  retryLabel: { ...typography.label, color: colors.textPrimary },
  list: { gap: spacing.sm },
  itemTitle: { ...typography.label, color: colors.textPrimary },
  long: { ...typography.bodyCompact, color: colors.positive, fontVariant: ['tabular-nums'] },
  short: { ...typography.bodyCompact, color: colors.negative, fontVariant: ['tabular-nums'] },
  historyRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  historyText: { flex: 1, minWidth: 0, gap: spacing.xxs },
  historyValue: { alignItems: 'flex-end', gap: spacing.xxs },
  detail: { ...typography.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
});
