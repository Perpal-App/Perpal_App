import { useMemo, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';

import { MailboxMark } from '@/assets/svg/MailboxMark';
import { PressableScale } from '@/components/ui/PressableScale';
import { UnderlineTabs, type UnderlineTabOption } from '@/components/ui/UnderlineTabs';
import { NotificationRow } from '@/features/home/components/NotificationRow';
import type { MarketNewsArticle } from '@/integrations/market-data/marketBriefing';
import {
  markAllInAppNotificationsRead,
  type InAppNotification,
} from '@/storage/inAppNotifications';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

const CLOSE_TARGET = 34;
const CLOSE_GLYPH = 15;
const GRABBER_WIDTH = 38;
const GRABBER_HEIGHT = 4;

type ReadFilter = 'all' | 'unread';

const FILTERS: readonly UnderlineTabOption<ReadFilter>[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
];

/** A run of events that happened on the same day, newest day first. */
type DayGroup = {
  readonly items: readonly InAppNotification[];
  readonly key: string;
  readonly label: string;
};

/**
 * The notifications sheet.
 *
 * Grouped by day rather than by kind. The kind moved onto each row as a glyph, which frees the
 * headings to answer the question a log is actually read with — when did this happen — and means
 * a single event no longer gets a whole titled section to itself.
 *
 * There is no back affordance anywhere in here on purpose: the sheet comes up from the bottom, so
 * the only exits are the close button, the backdrop, and dragging it back down. A back arrow would
 * promise a screen to return to that never existed.
 */
export function NotificationsSheet({
  activity,
  dragGesture,
  latestNews,
  onClose,
  topGainer,
  topLoser,
  unread,
}: {
  readonly activity: readonly InAppNotification[];
  /**
   * Resizes and dismisses the sheet. Built by the presenter, because the sheet's position is the
   * presenter's to own, and applied here to the whole grabber-and-title block.
   *
   * Typed off the factory rather than by importing the gesture's class name: `PanGesture` is not
   * re-exported from the package root, and a deep import into the library's build output would be
   * one refactor away from breaking.
   */
  readonly dragGesture: ReturnType<typeof Gesture.Pan>;
  readonly latestNews: MarketNewsArticle | null;
  readonly onClose: () => void;
  readonly topGainer: string | null;
  readonly topLoser: string | null;
  readonly unread: number;
}) {
  const [filter, setFilter] = useState<ReadFilter>('all');

  const groups = useMemo<readonly DayGroup[]>(() => {
    const scoped = filter === 'unread'
      ? activity.filter((item) => item.readAtMs === null)
      : activity;

    // The log is already newest-first, so a day boundary is just a change of key between
    // neighbours — no sorting, and no map keyed by date that would have to be ordered again.
    const days: { items: InAppNotification[]; key: string; label: string }[] = [];

    for (const item of scoped) {
      const key = new Date(item.createdAtMs).toDateString();
      const open = days[days.length - 1];

      if (open !== undefined && open.key === key) open.items.push(item);
      else days.push({ items: [item], key, label: dayLabel(item.createdAtMs) });
    }

    return days;
  }, [activity, filter]);

  const liveRows = useMemo(() => {
    const rows: LiveReading[] = [];

    if (topGainer !== null) rows.push({ label: 'Gainer', text: topGainer });
    if (topLoser !== null) rows.push({ label: 'Loser', text: topLoser });
    if (latestNews !== null) rows.push({ label: 'News', text: latestNews.headline });

    return rows;
  }, [latestNews, topGainer, topLoser]);

  // Live readings are not events and cannot be read or unread, so they have no business under a
  // filter that means "things I have not acknowledged".
  const showLive = filter === 'all' && liveRows.length > 0;

  return (
    <View accessibilityViewIsModal style={styles.sheet}>
      {/* The grabber and the title are one drag target. A 4pt bar is the affordance, not the hit
          area — asking for the bar itself is why the sheet felt like it would not move. The close
          button lives inside this region and still works, because the pan waits for the finger to
          travel before it claims anything. */}
      <GestureDetector gesture={dragGesture}>
        <View style={styles.grip}>
          <View accessibilityElementsHidden style={styles.grabberRow}>
            <View style={styles.grabber} />
          </View>

          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>Notifications</Text>
            <PressableScale
              accessibilityHint="Closes notifications"
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={10}
              onPress={onClose}
              style={styles.close}
            >
              <Svg height={CLOSE_GLYPH} viewBox="0 0 24 24" width={CLOSE_GLYPH}>
                <Path
                  d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5"
                  fill="none"
                  stroke={colors.textPrimary}
                  strokeLinecap="round"
                  strokeWidth={2.4}
                />
              </Svg>
            </PressableScale>
          </View>
        </View>
      </GestureDetector>

      {/* The filter and the bulk action share a line, because they are the two halves of one
          thought: which of these have I dealt with, and deal with all of them. */}
      <View style={styles.controls}>
        <View style={styles.tabs}>
          <UnderlineTabs onSelect={setFilter} options={FILTERS} selectedId={filter} />
        </View>
        {unread > 0 ? (
          <PressableScale
            accessibilityHint={`Acknowledges all ${unread} unread events`}
            accessibilityLabel="Mark all as read"
            accessibilityRole="button"
            hitSlop={8}
            onPress={markAllInAppNotificationsRead}
            style={styles.markAll}
          >
            <Text style={styles.markAllText}>Mark all read</Text>
          </PressableScale>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
      >
        {showLive ? (
          <Group label="Live market">
            {liveRows.map((row, index) => (
              <View
                key={row.label}
                style={[styles.liveRow, index === liveRows.length - 1 && styles.liveRowLast]}
              >
                <Text style={styles.liveLabel}>{row.label}</Text>
                <Text numberOfLines={3} style={styles.liveText}>{row.text}</Text>
              </View>
            ))}
          </Group>
        ) : null}

        <View accessibilityLiveRegion="polite" style={styles.groups}>
          {groups.length === 0 ? (
            <EmptyState filter={filter} />
          ) : groups.map((group) => (
            <Group key={group.key} label={group.label}>
              {group.items.map((item, index) => (
                <NotificationRow
                  item={item}
                  key={item.id}
                  last={index === group.items.length - 1}
                />
              ))}
            </Group>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** One venue reading. Not an event, so it carries no read state and no action. */
type LiveReading = { readonly label: string; readonly text: string };

/**
 * Nothing to show, said properly.
 *
 * A line of muted text was doing this job before, and an empty log looked indistinguishable from
 * a log that had failed to load. A drawing makes the state deliberate, and the copy separates the
 * two cases that both produce no rows: an empty history, and a history that is simply all read.
 *
 * The illustration is hidden from assistive tech — it carries no information the heading beneath
 * it does not already state, so announcing it would only add noise.
 */
function EmptyState({ filter }: { readonly filter: ReadFilter }) {
  const unreadView = filter === 'unread';

  return (
    <View style={styles.emptyState}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        <MailboxMark />
      </View>
      <Text accessibilityRole="header" style={styles.emptyTitle}>
        {unreadView ? 'You are all caught up' : 'No notifications yet'}
      </Text>
      <Text style={styles.emptyMessage}>
        {unreadView
          ? 'Every event has been read. Anything new will arrive here.'
          : 'Trade, funding, withdrawal, and wallet events will appear here as they happen.'}
      </Text>
    </View>
  );
}

/**
 * A heading and the card of rows under it.
 *
 * Flat fill, no gradient. A ramp repeated down five cards stopped reading as material and started
 * reading as five separate panels of slightly different colour, which is the look this redesign
 * was pulling away from. The border and the raised fill are enough to group.
 */
function Group({ children, label }: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.groupLabel}>{label}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

/**
 * "Today", "Yesterday", or the date.
 *
 * Compared as calendar days rather than by elapsed milliseconds: something that happened at 11pm
 * is yesterday once midnight passes, not twenty-four hours later.
 */
function dayLabel(timeMs: number): string {
  const day = new Date(timeMs).toDateString();
  const now = new Date();

  if (day === now.toDateString()) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === yesterday.toDateString()) return 'Yesterday';

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: now.getFullYear() === new Date(timeMs).getFullYear() ? undefined : 'numeric',
  }).format(new Date(timeMs));
}

const styles = StyleSheet.create({
  // Fills its host so that dragging the sheet to the top of the screen leaves no gap under it.
  // The presenter owns where it sits; this only says how tall it is allowed to be.
  sheet: {
    flex: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    overflow: 'hidden',
    borderTopLeftRadius: radii.panel,
    borderTopRightRadius: radii.panel,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  // The draggable block. Everything in here answers to the pan, which is why it is one view.
  grip: { paddingTop: spacing.sm },
  grabberRow: { alignItems: 'center', paddingBottom: spacing.sm },
  grabber: {
    width: GRABBER_WIDTH,
    height: GRABBER_HEIGHT,
    borderRadius: GRABBER_HEIGHT / 2,
    backgroundColor: colors.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: layout.screenPadding,
  },
  title: { ...typography.title, flex: 1, minWidth: 0, color: colors.textPrimary },
  close: {
    width: CLOSE_TARGET,
    height: CLOSE_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    backgroundColor: colors.glassTint,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tabs: { flexShrink: 1, minWidth: 0 },
  markAll: { flexShrink: 0, paddingBottom: spacing.xs },
  markAllText: { ...typography.caption, color: colors.accentSoft },
  list: {
    paddingTop: spacing.lg,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  groups: { gap: spacing.lg },
  group: { gap: spacing.xs },
  groupLabel: { ...typography.label, color: colors.textSecondary },
  card: {
    overflow: 'hidden',
    borderRadius: radii.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  liveRow: {
    gap: 2,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  liveRowLast: { borderBottomWidth: 0 },
  liveLabel: { ...typography.eyebrow, color: colors.textMuted },
  liveText: { ...typography.bodyCompact, color: colors.textPrimary },
  // Centred and given room above, so the drawing reads as the answer to the empty list rather
  // than as a graphic that happens to be sitting where rows would be.
  emptyState: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  emptyTitle: {
    ...typography.heading,
    marginTop: spacing.xs,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  emptyMessage: { ...typography.bodyCompact, textAlign: 'center', color: colors.textMuted },
});
