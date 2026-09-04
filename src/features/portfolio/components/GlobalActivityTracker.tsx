import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyHistoryMark } from '@/assets/svg/EmptyHistoryMark';
import { SkeletonText } from '@/components/feedback/Skeleton';
import { PressableScale } from '@/components/ui/PressableScale';
import {
  ActivityFilters,
  activityFilterLabel,
  type ActivityFilter,
} from '@/features/portfolio/components/ActivityFilters';
import { ActivityRow } from '@/features/portfolio/components/ActivityRow';
import {
  matchesActivityQuery,
  mergeActivity,
} from '@/features/portfolio/components/activityItems';
import { usePacificaActivity } from '@/features/portfolio/hooks/usePacificaActivity';
import { useSolanaWalletActivity } from '@/features/portfolio/hooks/useSolanaWalletActivity';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  readInAppNotifications,
  subscribeInAppNotifications,
} from '@/storage/inAppNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const VISIBLE_PAGE_SIZE = 40;

/**
 * The account's history: trades from the venue, fund movements from the venue and from this device.
 *
 * Search and filters appear only once there is history to search. Handing a reader a filter strip
 * and an empty box above an empty list is three controls that can only produce the state they are
 * already looking at — so before the first event the section is just the illustration and a line
 * saying what will land here.
 *
 * Two distinct empty states, and the difference matters: nothing yet gets the drawing, because it is
 * a resting state and worth making pleasant, while nothing *matching* gets one line of text, because
 * the reader is mid-task and an illustration would be in the way of narrowing the query.
 */
export function GlobalActivityTracker({
  account,
  apiOrigin,
  generation,
  publicAccount,
  rpcUrl,
  signer,
}: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly generation: number;
  readonly publicAccount: string | null;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner | null;
}) {
  const remote = usePacificaActivity(apiOrigin, account);
  const wallet = useSolanaWalletActivity({
    privateAddress: account,
    publicAddress: publicAccount,
    rpcUrl,
    signer,
  });
  const local = useSyncExternalStore(
    subscribeInAppNotifications,
    readInAppNotifications,
    readInAppNotifications,
  );
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [query, setQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(VISIBLE_PAGE_SIZE);

  const items = useMemo(
    () => mergeActivity(remote.state.data, local, wallet.state.data),
    [local, remote.state.data, wallet.state.data],
  );
  const remoteBalanceCount = remote.state.data?.balances.length ?? 0;
  const remoteTradeCount = remote.state.data?.trades.length ?? 0;
  useEffect(() => {
    if (!__DEV__) return;
    console.info('[Perpal portfolio activity]', JSON.stringify({
      balanceCount: remoteBalanceCount,
      event: 'render_state',
      generation,
      localCount: local.length,
      mergedCount: items.length,
      remoteStatus: remote.state.status,
      tradeCount: remoteTradeCount,
      walletCount: wallet.state.data.length,
      walletStatus: wallet.state.status,
    }));
  }, [
    generation,
    items.length,
    local.length,
    remoteBalanceCount,
    remote.state.status,
    remoteTradeCount,
    wallet.state.data.length,
    wallet.state.status,
  ]);
  const visible = useMemo(
    () => items.filter((item) => (
      (filter === 'all' || item.kind === filter) && matchesActivityQuery(item, query)
    )),
    [filter, items, query],
  );
  const displayed = visible.slice(0, visibleLimit);

  const remoteUnavailable = remote.state.status === 'error'
    || remote.state.status === 'stale'
    || wallet.state.status === 'error'
    || wallet.state.status === 'stale';
  const loading = (
    remote.state.status === 'loading'
    || wallet.state.status === 'loading'
    || remoteUnavailable
  )
    && items.length === 0;
  const narrowed = filter !== 'all' || query.trim().length > 0;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.heading}>Activity</Text>
        {remoteUnavailable ? (
          <PressableScale
            accessibilityLabel="Retry activity"
            accessibilityRole="button"
            onPress={() => {
              remote.refresh();
              wallet.refresh();
            }}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Retry</Text>
          </PressableScale>
        ) : null}
      </View>

      {/* Always mounted, including on an empty history. Gating them on there being something to
          search meant the controls appeared and disappeared as the first event landed, and a reader
          could not see what the section is capable of until it already had contents. */}
      <ActivityFilters
        filter={filter}
        onFilterChange={(next) => {
          setFilter(next);
          setVisibleLimit(VISIBLE_PAGE_SIZE);
        }}
        onQueryChange={(next) => {
          setQuery(next);
          setVisibleLimit(VISIBLE_PAGE_SIZE);
        }}
        query={query}
      />

      {remote.state.data?.truncated ? (
        <Text accessibilityRole="alert" selectable style={styles.error}>
          Showing the latest available provider history.
        </Text>
      ) : null}

      <View style={styles.list}>
        {loading ? (
          <View accessibilityLabel="Loading activity" accessibilityRole="progressbar" style={styles.loading}>
            <SkeletonText role="label" width="82%" />
            <SkeletonText role="bodyCompact" width="64%" />
            <SkeletonText role="label" width="76%" />
          </View>
        ) : items.length === 0 ? (
          <EmptyHistory />
        ) : visible.length === 0 ? (
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {query.trim().length > 0
              ? `No activity matches “${query.trim()}”.`
              : 'No activity of this kind yet.'}
          </Text>
        ) : (
          displayed.map((item, index) => (
            <ActivityRow item={item} key={item.id} last={index === displayed.length - 1} />
          ))
        )}
      </View>

      {displayed.length < visible.length ? (
        <PressableScale
          accessibilityLabel="Show older activity"
          accessibilityRole="button"
          onPress={() => setVisibleLimit((current) => current + VISIBLE_PAGE_SIZE)}
          style={styles.more}
        >
          <Text style={styles.moreText}>Show older</Text>
        </PressableScale>
      ) : null}

      {/* Says what the list is showing without making the reader count rows, and names the filter —
          which is the one thing lost by moving the options behind a button. Only once something is
          actually narrowing, so a full history carries no tally. */}
      {narrowed && visible.length > 0 ? (
        <Text accessibilityLiveRegion="polite" style={styles.count}>
          {filter === 'all'
            ? `${visible.length} of ${items.length} events`
            : `${activityFilterLabel(filter)} · ${visible.length} of ${items.length} events`}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The history before anything has happened.
 *
 * The illustration is hidden from assistive tech — it carries nothing the heading beneath it does not
 * already state, so announcing it would only add noise.
 */
function EmptyHistory() {
  return (
    <View style={styles.empty}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        <EmptyHistoryMark />
      </View>
      <Text accessibilityRole="header" style={styles.emptyTitle}>No activity yet</Text>
      <Text style={styles.emptyMessage}>
        Completed trades, deposits, and withdrawals will appear here as they happen.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // No top rule. The screen separates its blocks with its own gap, and a hairline above every section
  // drew a line across a page that already has a card edge every few points.
  section: { gap: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  // `label`, matching the other section headings on this screen rather than the larger `heading` it
  // used: one screen, one level of section title.
  heading: { ...typography.label, flex: 1, color: colors.textPrimary },
  retry: {
    minWidth: 52,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  retryText: { ...typography.label, color: colors.accentSoft },
  // Clipped, and that is what makes the morph read as a shape rather than a slide: the rows are laid
  // out at their final size the instant a filter changes while the box is still travelling to meet
  // them, so the overflow would otherwise spill past it for the length of the spring.
  list: { overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  loading: { gap: spacing.sm, paddingVertical: spacing.md },
  status: { ...typography.bodyCompact, paddingVertical: spacing.md, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.negative },
  more: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
  },
  moreText: { ...typography.label, color: colors.textPrimary },
  count: { ...typography.caption, color: colors.textMuted },
  empty: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  emptyTitle: { ...typography.label, marginTop: spacing.xs, color: colors.textPrimary },
  emptyMessage: {
    ...typography.caption,
    maxWidth: 260,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
