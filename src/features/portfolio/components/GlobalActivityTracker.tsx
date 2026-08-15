import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import {
  fetchPacificaActivity,
  type PacificaActivity,
  type PacificaBalanceActivity,
  type PacificaTradeActivity,
} from '@/integrations/perps/pacifica/pacificaActivity';
import {
  readInAppNotifications,
  subscribeInAppNotifications,
  type InAppNotification,
} from '@/storage/inAppNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const REFRESH_INTERVAL_MS = 15_000;
const MAX_VISIBLE_ITEMS = 40;

type ActivityItem = {
  readonly createdAtMs: number;
  readonly detail: string;
  readonly id: string;
  readonly kind: 'trade' | 'funding' | 'withdrawal';
  readonly outcome: 'success' | 'error' | 'info';
  readonly title: string;
  readonly value: string | null;
};

type RemoteState = {
  readonly data: PacificaActivity | null;
  readonly status: 'loading' | 'ready' | 'stale' | 'error';
};

export function GlobalActivityTracker({
  account,
  apiOrigin,
}: {
  readonly account: string;
  readonly apiOrigin: string;
}) {
  const remote = usePacificaActivity(apiOrigin, account);
  const local = useSyncExternalStore(
    subscribeInAppNotifications,
    readInAppNotifications,
    readInAppNotifications,
  );
  const items = useMemo(
    () => mergeActivity(remote.state.data, local),
    [local, remote.state.data],
  );
  const remoteUnavailable = remote.state.status === 'error' || remote.state.status === 'stale';

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.heading}>Activity</Text>
          <Text selectable style={styles.caption}>Trades and fund movements</Text>
        </View>
        {remoteUnavailable ? (
          <PressableScale
            accessibilityLabel="Retry activity"
            accessibilityRole="button"
            onPress={remote.refresh}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Retry</Text>
          </PressableScale>
        ) : null}
      </View>

      {remote.state.status === 'loading' && items.length === 0 ? (
        <Text accessibilityLiveRegion="polite" style={styles.empty}>Loading activity…</Text>
      ) : null}

      {remoteUnavailable ? (
        <Text accessibilityRole="alert" selectable style={styles.error}>
          Trade history is temporarily unavailable. Confirmed private fund events on this device remain visible.
        </Text>
      ) : null}

      {remote.state.status !== 'loading' && items.length === 0 ? (
        <Text selectable style={styles.empty}>
          No activity yet. Completed trades and fund movements will appear here.
        </Text>
      ) : null}

      {items.length > 0 ? (
        <View style={styles.list}>
          {items.map((item, index) => (
            <ActivityRow
              item={item}
              key={item.id}
              last={index === items.length - 1}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ActivityRow({ item, last }: {
  readonly item: ActivityItem;
  readonly last: boolean;
}) {
  const color = item.outcome === 'error'
    ? colors.negative
    : item.value?.startsWith('+$')
      ? colors.positive
      : item.value?.startsWith('-$')
        ? colors.negative
        : colors.textPrimary;

  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View accessibilityElementsHidden style={styles.icon}>
        <MaterialCommunityIcons
          color={item.outcome === 'error' ? colors.negative : colors.textSecondary}
          name={item.outcome === 'error'
            ? 'alert-circle-outline'
            : item.kind === 'trade'
              ? 'chart-line'
              : item.kind === 'funding'
                ? 'arrow-down'
                : 'arrow-up'}
          size={20}
        />
      </View>
      <View style={styles.body}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
          {item.value === null ? null : (
            <Text selectable style={[styles.value, { color }]}>{item.value}</Text>
          )}
        </View>
        <Text numberOfLines={2} selectable style={styles.detail}>{item.detail}</Text>
        <Text selectable style={styles.time}>{formatTime(item.createdAtMs)}</Text>
      </View>
    </View>
  );
}

function usePacificaActivity(apiOrigin: string, account: string) {
  const [state, setState] = useState<RemoteState>({ data: null, status: 'loading' });
  const [refreshKey, setRefreshKey] = useState(0);
  const hasData = useRef(false);

  useEffect(() => {
    hasData.current = false;
    setState({ data: null, status: 'loading' });
  }, [account, apiOrigin]);

  useFocusEffect(useCallback(() => {
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const data = await fetchPacificaActivity(apiOrigin, account, controller.signal);
        if (active) {
          hasData.current = true;
          setState({ data, status: 'ready' });
        }
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          if (__DEV__) {
            console.error('[Perpal activity failed]', {
              error: cause instanceof Error ? cause.message : typeof cause,
            });
          }
          setState((current) => ({
            data: current.data,
            status: hasData.current ? 'stale' : 'error',
          }));
        }
      } finally {
        if (active) timer = setTimeout(() => void load(), REFRESH_INTERVAL_MS);
      }
    };

    void load();
    return () => {
      active = false;
      controller?.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [account, apiOrigin, refreshKey]));

  return {
    refresh: () => setRefreshKey((value) => value + 1),
    state,
  };
}

function mergeActivity(
  remote: PacificaActivity | null,
  local: readonly InAppNotification[],
): readonly ActivityItem[] {
  const items: ActivityItem[] = [
    ...(remote?.trades.map(tradeItem) ?? []),
    ...(remote?.balances.filter(isFundMovement).map(balanceItem) ?? []),
    ...local.filter((item) => item.kind === 'funding' || item.kind === 'withdrawal').map(localItem),
  ];

  return items
    .sort((left, right) => right.createdAtMs - left.createdAtMs || left.id.localeCompare(right.id))
    .slice(0, MAX_VISIBLE_ITEMS);
}

function tradeItem(trade: PacificaTradeActivity): ActivityItem {
  const direction = trade.side.endsWith('long') ? 'long' : 'short';
  const opening = trade.side.startsWith('open');
  const title = trade.cause === 'market_liquidation'
    ? `${trade.symbol} liquidated`
    : trade.cause === 'backstop_liquidation'
      ? `${trade.symbol} backstop liquidation`
      : trade.cause === 'settlement'
        ? `${trade.symbol} settled`
        : `${opening ? 'Opened' : 'Closed'} ${trade.symbol} ${direction}`;

  return {
    createdAtMs: trade.createdAtMs,
    detail: `${trimDecimal(trade.amount)} ${trade.symbol} at ${usd(trade.price)} · Fee ${usd(trade.fee)}`,
    id: `trade:${trade.historyId}`,
    kind: 'trade',
    outcome: trade.cause === 'normal' ? 'success' : 'info',
    title,
    value: opening ? null : signedUsd(trade.pnl),
  };
}

function balanceItem(item: PacificaBalanceActivity): ActivityItem {
  const kind = item.eventType === 'withdraw' ? 'withdrawal' : 'funding';
  return {
    createdAtMs: item.createdAtMs,
    detail: `Private trading balance ${usd(item.balance)}`,
    id: `balance:${item.createdAtMs}:${item.eventType}:${item.amount}:${item.balance}`,
    kind,
    outcome: 'success',
    title: balanceTitle(item.eventType),
    value: signedUsd(item.amount),
  };
}

function localItem(item: InAppNotification): ActivityItem {
  return {
    createdAtMs: item.createdAtMs,
    detail: item.message,
    id: `local:${item.id}`,
    kind: item.kind === 'withdrawal' ? 'withdrawal' : 'funding',
    outcome: item.outcome,
    title: item.title,
    value: null,
  };
}

function isFundMovement(item: PacificaBalanceActivity): boolean {
  return !['trade', 'market_liquidation', 'backstop_liquidation', 'adl_liquidation']
    .includes(item.eventType);
}

function balanceTitle(eventType: string): string {
  switch (eventType) {
    case 'deposit': return 'Trading funds deposited';
    case 'deposit_release': return 'Deposit available';
    case 'withdraw': return 'Trading funds withdrawn';
    case 'funding': return 'Funding payment';
    case 'payout': return 'Account payout';
    case 'subaccount_transfer': return 'Balance transferred';
    default: return eventType.split('_').map(capitalize).join(' ');
  }
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function signedUsd(value: string): string {
  if (/^-?0+(?:\.0+)?$/u.test(value)) return '$0';
  return value.startsWith('-') ? `-${usd(value.slice(1))}` : `+${usd(value)}`;
}

function usd(value: string): string {
  return `$${trimDecimal(value)}`;
}

function trimDecimal(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const visibleFraction = fraction.replace(/0+$/u, '');
  const body = visibleFraction.length === 0 ? grouped : `${grouped}.${visibleFraction}`;
  return negative ? `-${body}` : body;
}

function formatTime(timeMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(timeMs));
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerCopy: { flex: 1, gap: spacing.xxs },
  heading: { ...typography.heading, color: colors.textPrimary },
  caption: { ...typography.caption, color: colors.textSecondary },
  retry: {
    minWidth: 52,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  retryText: { ...typography.label, color: colors.accentSoft },
  empty: { ...typography.bodyCompact, color: colors.textSecondary, paddingVertical: spacing.md },
  error: { ...typography.caption, color: colors.negative },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  icon: {
    width: 38,
    height: 38,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  title: { ...typography.label, flex: 1, color: colors.textPrimary },
  value: { ...typography.label, fontVariant: ['tabular-nums'] },
  detail: { ...typography.caption, color: colors.textSecondary },
  time: { ...typography.caption, color: colors.textMuted },
});
