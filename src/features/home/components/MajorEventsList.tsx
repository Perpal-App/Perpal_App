import { StyleSheet, Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import type { MarketBriefingState } from '@/features/home/hooks/useMarketBriefing';
import type { MajorFinanceEvent } from '@/integrations/market-data/marketBriefing';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * The scheduled U.S. releases, as a dated rail.
 *
 * Headless: it draws the rail and nothing else, because it is no longer a section of its own.
 * It renders under the market-news filter's "Events" tab, which supplies the heading — the
 * calendar and the news are the same briefing request, and giving each its own titled block
 * spent two screens of height on one payload.
 */
export function MajorEventsList({ data }: Pick<MarketBriefingState, 'data'>) {
  return (
    <View style={styles.section}>
      {data === null ? (
        Array.from({ length: 3 }, (_unused, index) => (
          <View key={index} style={styles.pending}><SkeletonText role="label" width="75%" /></View>
        ))
      ) : data.events.length === 0 ? (
        <Text style={styles.unavailable}>No high-impact U.S. events in the next 30 days.</Text>
      ) : data.events.slice(0, 6).map((event, index) => (
        <TimelineItem event={event} first={index === 0} key={`${event.scheduledAtMs}:${event.event}`} />
      ))}
    </View>
  );
}

function TimelineItem({ event, first }: {
  readonly event: MajorFinanceEvent;
  readonly first: boolean;
}) {
  const values = [
    event.estimate === null ? null : `Forecast ${withUnit(event.estimate, event.unit)}`,
    event.previous === null ? null : `Previous ${withUnit(event.previous, event.unit)}`,
  ].filter((value): value is string => value !== null);

  return (
    <View style={styles.item}>
      <View style={styles.rail}>
        <View style={[styles.dot, first && styles.dotNext]} />
        <View style={styles.line} />
      </View>
      <View style={styles.body}>
        <Text style={styles.time}>{formatEventTime(event.scheduledAtMs)}</Text>
        <Text style={styles.event}>{event.event}</Text>
        {values.length > 0 ? <Text style={styles.values}>{values.join(' · ')}</Text> : null}
      </View>
    </View>
  );
}

function withUnit(value: string, unit: string | null): string {
  return unit === null || value.endsWith(unit) ? value : `${value} ${unit}`;
}

function formatEventTime(timeMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZoneName: 'short',
  }).format(new Date(timeMs));
}

const styles = StyleSheet.create({
  section: { gap: spacing.xxs },
  pending: { minHeight: 54, justifyContent: 'center' },
  unavailable: { ...typography.bodyCompact, color: colors.textMuted },
  item: { minHeight: 64, flexDirection: 'row', gap: spacing.sm },
  rail: { width: 12, alignItems: 'center' },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: spacing.xs,
    backgroundColor: colors.textMuted,
  },
  dotNext: { backgroundColor: colors.accent },
  line: { flex: 1, width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  body: { flex: 1, paddingBottom: spacing.sm },
  time: { ...typography.caption, color: colors.textMuted },
  event: { ...typography.bodyCompact, color: colors.textPrimary },
  values: { ...typography.caption, color: colors.textSecondary },
});
