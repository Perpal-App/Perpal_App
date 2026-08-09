import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/ui/PressableScale';
import type { MarketNewsArticle } from '@/integrations/market-data/marketBriefing';
import {
  markAllInAppNotificationsRead,
  markInAppNotificationRead,
  type InAppNotification,
  type InAppNotificationKind,
} from '@/storage/inAppNotifications';
import { colors, gradients, layout, radii, spacing, typography } from '@/theme/tokens';

const CLOSE_TARGET = 34;
const CLOSE_GLYPH = 15;
const CHECK_TARGET = 30;
const CHECK_GLYPH = 15;
/** Outcome marker. Small enough to read as punctuation rather than as a bullet. */
const DOT = 7;

/**
 * Section headings, one per kind of event.
 *
 * Sentence case and plural, because these are titles over a group rather than tags on a row.
 * The kind used to be printed on every row as an all-caps label, which meant a run of trade
 * events repeated the word "TRADE" down the whole sheet; grouping says it once.
 */
const KIND_TITLES: Readonly<Record<InAppNotificationKind, string>> = {
  trade: 'Trades',
  funding: 'Funding',
  withdrawal: 'Withdrawals',
  wallet: 'Wallet',
};

/**
 * Section order, fixed rather than derived from what arrived first.
 *
 * Roughly the order these matter when something has gone wrong: what you did, what it cost,
 * what left the account, and the wallet underneath it all. A sheet that reorders itself as
 * events land would move a heading out from under the reader's thumb.
 */
const KIND_ORDER: readonly InAppNotificationKind[] = [
  'trade',
  'funding',
  'withdrawal',
  'wallet',
];

/** One venue reading in the live section. Not an event, so it carries no read state. */
type LiveReading = {
  readonly label: string;
  readonly text: string;
  readonly tone: 'positive' | 'negative' | 'neutral';
};

/**
 * The notifications sheet: live venue readings on top, the app's own event log under them.
 *
 * Grouped into cards with real headings instead of one flat run of rows under two all-caps
 * eyebrows. A card gives each group an edge, which is what lets the eye skip a whole category
 * it does not care about — the previous single column had to be read in order.
 *
 * Read state is per row and acknowledged in place. Marking one read never removes it, because
 * this is a log rather than an inbox: the reason to come here is usually to check what happened,
 * and an event that vanished when acknowledged would take its own evidence with it.
 */
export function NotificationsSheet({
  activity,
  latestNews,
  onClose,
  topGainer,
  topLoser,
  unread,
}: {
  readonly activity: readonly InAppNotification[];
  readonly latestNews: MarketNewsArticle | null;
  readonly onClose: () => void;
  readonly topGainer: string | null;
  readonly topLoser: string | null;
  readonly unread: number;
}) {
  const groups = useMemo(
    () => KIND_ORDER
      .map((kind) => ({ items: activity.filter((item) => item.kind === kind), kind }))
      .filter((group) => group.items.length > 0),
    [activity],
  );

  // Built by pushing rather than by mapping over a sparse literal and filtering the holes out.
  // Each reading is optional and independent, so a conditional push says that directly and keeps
  // the tone literals narrow without a type guard standing in for the obvious.
  const liveRows = useMemo(() => {
    const rows: LiveReading[] = [];

    if (topGainer !== null) rows.push({ label: 'Gainer', text: topGainer, tone: 'positive' });
    if (topLoser !== null) rows.push({ label: 'Loser', text: topLoser, tone: 'negative' });
    if (latestNews !== null) {
      rows.push({ label: 'News', text: latestNews.headline, tone: 'neutral' });
    }

    return rows;
  }, [latestNews, topGainer, topLoser]);

  return (
    <View accessibilityViewIsModal style={styles.sheet}>
      <View style={styles.header}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>{summary(activity.length, unread)}</Text>
        </View>

        {/* Both actions live top right, and only one of them is always there. "Mark all read"
            is absent when there is nothing unread rather than sitting disabled: a control that
            cannot do anything is still something to read past. */}
        <View style={styles.actions}>
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
          <PressableScale
            accessibilityHint="Closes notifications"
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={10}
            onPress={onClose}
            style={styles.close}
          >
            <CloseIcon />
          </PressableScale>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
      >
        {liveRows.length > 0 ? (
          <Section title="Live market">
            {liveRows.map((row, index) => (
              <LiveRow
                key={row.label}
                label={row.label}
                last={index === liveRows.length - 1}
                text={row.text}
                tone={row.tone}
              />
            ))}
          </Section>
        ) : null}

        <View accessibilityLiveRegion="polite" style={styles.groups}>
          {groups.length === 0 ? (
            <Section title="App activity">
              <Text style={styles.empty}>
                Trade, funding, withdrawal, and wallet events will appear here.
              </Text>
            </Section>
          ) : groups.map((group) => (
            <Section key={group.kind} title={KIND_TITLES[group.kind]}>
              {group.items.map((item, index) => (
                <ActivityRow
                  item={item}
                  key={item.id}
                  last={index === group.items.length - 1}
                />
              ))}
            </Section>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * A heading and the card of rows under it.
 *
 * The card carries the app's raised material — a lit top edge falling to a deeper base — and
 * clips it, so one gradient serves however many rows the group holds and none of the rows has
 * to know it is inside a rounded box.
 */
function Section({ children, title }: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        <LinearGradient
          colors={gradients.surfaceRaise.colors}
          end={{ x: 0.5, y: 1 }}
          locations={gradients.surfaceRaise.locations}
          start={{ x: 0.5, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {children}
      </View>
    </View>
  );
}

/**
 * One logged event.
 *
 * Two separate things are encoded, and deliberately not in the same place. The dot's colour is
 * the outcome — whether the thing succeeded — and that never changes. Brightness and the
 * presence of the tick are the read state. Folding both into one marker would mean an
 * acknowledged failure and an unacknowledged success could not be told apart.
 */
function ActivityRow({ item, last }: {
  readonly item: InAppNotification;
  readonly last: boolean;
}) {
  const unread = item.readAtMs === null;

  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={[styles.dot, toneFill(item.outcome)]} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, !unread && styles.rowTitleRead]}>{item.title}</Text>
        <Text style={styles.rowMessage}>{item.message}</Text>
        <Text style={styles.rowTime}>{formatTime(item.createdAtMs)}</Text>
      </View>
      {unread ? (
        <PressableScale
          accessibilityHint="Marks this event as read"
          accessibilityLabel={`Mark ${item.title} as read`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => markInAppNotificationRead(item.id)}
          style={styles.check}
        >
          <CheckIcon />
        </PressableScale>
      ) : null}
    </View>
  );
}

/** A venue reading. No read state: nothing here is an event that happened to the account. */
function LiveRow({ label, last, text, tone }: {
  readonly label: string;
  readonly last: boolean;
  readonly text: string;
  readonly tone: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={[styles.dot, toneFill(tone)]} />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text numberOfLines={3} style={styles.rowTitle}>{text}</Text>
      </View>
    </View>
  );
}

/** Rounded caps and joins, so a 1.9pt cross has no hard points at its four ends. */
function CloseIcon() {
  return (
    <Svg height={CLOSE_GLYPH} viewBox="0 0 24 24" width={CLOSE_GLYPH}>
      <Path
        d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5"
        fill="none"
        stroke={colors.textPrimary}
        strokeLinecap="round"
        strokeWidth={2.4}
      />
    </Svg>
  );
}

function CheckIcon() {
  return (
    <Svg height={CHECK_GLYPH} viewBox="0 0 24 24" width={CHECK_GLYPH}>
      <Path
        d="M5 12.6 9.7 17.3 19 8"
        fill="none"
        stroke={colors.accentSoft}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.4}
      />
    </Svg>
  );
}

function toneFill(tone: 'positive' | 'negative' | 'neutral' | 'success' | 'error' | 'info') {
  if (tone === 'positive' || tone === 'success') return styles.dotPositive;
  if (tone === 'negative' || tone === 'error') return styles.dotNegative;
  return styles.dotNeutral;
}

/**
 * The count line under the title.
 *
 * Leads with what is unread when anything is, because that is the number the badge on the bell
 * was showing and the reason the sheet was opened.
 */
function summary(total: number, unread: number): string {
  if (total === 0) return 'No app events yet';
  if (unread === 0) return total === 1 ? '1 event, all read' : `${total} events, all read`;
  return `${unread} unread of ${total}`;
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
  sheet: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    maxHeight: '100%',
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    paddingHorizontal: layout.screenPadding,
  },
  headingCopy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textMuted },
  actions: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // A text action, not a filled button. It is the secondary of the two controls up here and a
  // second solid target beside the close disc would make the header read as a toolbar.
  markAll: { paddingVertical: spacing.xxs },
  markAllText: { ...typography.caption, color: colors.accentSoft },
  // The same glass disc as the bell that opened the sheet, so closing looks like the inverse of
  // opening rather than like a different control borrowed from somewhere else.
  close: {
    width: CLOSE_TARGET,
    height: CLOSE_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    backgroundColor: colors.glassTint,
  },
  list: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  groups: { gap: spacing.lg },
  section: { gap: spacing.xs },
  sectionTitle: { ...typography.heading, color: colors.textPrimary },
  card: {
    overflow: 'hidden',
    borderRadius: radii.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // The card's own edge closes the group, so the last row must not draw a second line inside it.
  rowLast: { borderBottomWidth: 0 },
  // Nudged down onto the first line's optical centre. Aligning it to the text box instead puts it
  // above the cap height, where it reads as floating off the top of the row.
  dot: {
    width: DOT,
    height: DOT,
    marginTop: 7,
    flexShrink: 0,
    borderRadius: DOT / 2,
  },
  dotPositive: { backgroundColor: colors.positive },
  dotNegative: { backgroundColor: colors.negative },
  dotNeutral: { backgroundColor: colors.accentSoft },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { ...typography.eyebrow, color: colors.textMuted },
  rowTitle: { ...typography.bodyCompact, color: colors.textPrimary },
  // Read rows step back rather than disappearing. Still legible, clearly already dealt with.
  rowTitleRead: { color: colors.textSecondary },
  rowMessage: { ...typography.caption, color: colors.textSecondary },
  rowTime: { ...typography.caption, marginTop: 2, color: colors.textMuted },
  check: {
    width: CHECK_TARGET,
    height: CHECK_TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    backgroundColor: colors.glassTint,
  },
  empty: { ...typography.bodyCompact, padding: spacing.md, color: colors.textMuted },
});
