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
import Animated from 'react-native-reanimated';

import { EmptyHistoryMark } from '@/assets/svg/EmptyHistoryMark';
import { layoutMorph } from '@/components/motion/layoutMorph';
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
import {
  fetchPacificaActivity,
  type PacificaActivity,
} from '@/integrations/perps/pacifica/pacificaActivity';
import type { VelocityHistoryState } from '@/features/portfolio/hooks/useVelocityAccount';
import {
  readInAppNotifications,
  subscribeInAppNotifications,
} from '@/storage/inAppNotifications';
import { colors, radii, spacing, typography } from '@/theme/tokens';

const REFRESH_INTERVAL_MS = 15_000;

type RemoteState = {
  readonly data: PacificaActivity | null;
  readonly status: 'error' | 'loading' | 'ready' | 'stale';
};

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
  onVelocityRefresh,
  velocityHistory,
}: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly onVelocityRefresh: () => void;
  readonly velocityHistory: VelocityHistoryState;
}) {
  const remote = usePacificaActivity(apiOrigin, account);
  const local = useSyncExternalStore(
    subscribeInAppNotifications,
    readInAppNotifications,
    readInAppNotifications,
  );
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [query, setQuery] = useState('');

  const items = useMemo(
    () => mergeActivity(remote.state.data, velocityHistory.data, local),
    [local, remote.state.data, velocityHistory.data],
  );
  const visible = useMemo(
    () => items.filter((item) => (
      (filter === 'all' || item.kind === filter) && matchesActivityQuery(item, query)
    )),
    [filter, items, query],
  );

  const remoteUnavailable = remote.state.status === 'error'
    || remote.state.status === 'stale'
    || velocityHistory.status === 'error';
  const loading = (remote.state.status === 'loading' || velocityHistory.status === 'loading')
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
              onVelocityRefresh();
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
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        query={query}
      />

      {remoteUnavailable ? (
        <Text accessibilityRole="alert" selectable style={styles.error}>
          Some venue history is temporarily unavailable. Confirmed events remain visible.
        </Text>
      ) : null}

      {velocityHistory.data?.truncated ? (
        <Text accessibilityRole="alert" selectable style={styles.error}>
          Showing the latest 1,000 Velocity account transactions.
        </Text>
      ) : null}

      {/* The list resizes on every filter press and every keystroke, so it carries the app's layout
          spring — and so does the section, because a box that grows while its neighbours snap around
          it is worse than no animation at all. */}
      <Animated.View layout={layoutMorph()} style={styles.list}>
        {loading ? (
          <Text accessibilityLiveRegion="polite" style={styles.status}>Loading activity…</Text>
        ) : items.length === 0 ? (
          <EmptyHistory />
        ) : visible.length === 0 ? (
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {query.trim().length > 0
              ? `No activity matches “${query.trim()}”.`
              : 'No activity of this kind yet.'}
          </Text>
        ) : (
          visible.map((item, index) => (
            <ActivityRow item={item} key={item.id} last={index === visible.length - 1} />
          ))
        )}
      </Animated.View>

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
  status: { ...typography.bodyCompact, paddingVertical: spacing.md, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.negative },
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
