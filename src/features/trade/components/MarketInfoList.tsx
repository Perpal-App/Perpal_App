import { StyleSheet, Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { formatCompactUsd } from '@/domain/money/amount';
import {
  formatPacificaRatePercent,
  type PacificaMarket,
  type PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import { colors, spacing, typography } from '@/theme/tokens';

/** Placeholder shape shared with the markets table and the figure strip. */
const UNAVAILABLE = '--.--';

/** Value tones this list uses. `plain` is the default bright numeral. */
type StatTone = 'plain' | 'positive' | 'negative' | 'time';

/**
 * The venue's market data as a flat list.
 *
 * Deliberately not a card: it takes its structure from the tab rule above it and
 * from an even row rhythm, the way an order book or a trades feed does. A filled,
 * bordered, rounded box around six label/value rows was three boundaries doing
 * the work of one, and it made a short list look like a heavy object.
 *
 * Colour is spent only where a number has direction — funding says which side
 * pays — plus the accent tint on the timestamp, which keeps a value that is not a
 * quantity from reading like one.
 */
export function MarketInfoList({
  market,
  snapshot,
}: {
  readonly market: PacificaMarket;
  readonly snapshot: PacificaMarketSnapshot | null;
}) {
  const pending = snapshot === null;

  return (
    <View style={styles.list}>
      <Stat
        label="Open interest"
        pending={pending}
        value={snapshot?.openInterest == null
          ? UNAVAILABLE
          : formatCompactUsd(snapshot.openInterest)}
      />
      <Stat
        label="Funding rate"
        pending={pending}
        tone={rateTone(snapshot?.fundingRate ?? null)}
        value={snapshot === null ? UNAVAILABLE : formatPacificaRatePercent(snapshot.fundingRate)}
      />
      <Stat
        label="Next funding"
        pending={pending}
        tone={rateTone(snapshot?.nextFundingRate ?? null)}
        value={snapshot === null
          ? UNAVAILABLE
          : formatPacificaRatePercent(snapshot.nextFundingRate)}
      />
      <Stat label="Maximum leverage" value={`${market.maxLeverage}×`} />
      <Stat label="Tick size" value={`$${market.tickSize}`} />
      <Stat label="Lot size" value={`${market.lotSize} ${market.baseAsset}`} />
      <Stat label="Minimum order" value={`${market.minOrderSize} ${market.baseAsset}`} />
      <Stat label="Maximum order" value={`${market.maxOrderSize} ${market.baseAsset}`} />
      <Stat
        label="Margin mode"
        value={market.isolatedOnly ? 'Isolated only' : 'Cross or isolated'}
      />
      <Stat
        label="Oracle update"
        pending={pending}
        tone="time"
        value={snapshot?.pricePublishedAtMs == null
          ? UNAVAILABLE
          : formatTime(snapshot.pricePublishedAtMs)}
      />
      <Text style={styles.source}>Source: Pacifica public API</Text>
    </View>
  );
}

function Stat({
  label,
  pending = false,
  tone = 'plain',
  value,
}: {
  readonly label: string;
  readonly pending?: boolean;
  readonly tone?: StatTone;
  readonly value: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.label}>{label}</Text>
      {pending ? (
        <SkeletonText align="right" role="bodyCompact" width={78} />
      ) : (
        <Text
          numberOfLines={1}
          selectable
          style={[
            styles.value,
            tone === 'positive' && styles.positive,
            tone === 'negative' && styles.negative,
            tone === 'time' && styles.time,
            value === UNAVAILABLE && styles.absent,
          ]}
        >
          {value}
        </Text>
      )}
    </View>
  );
}

/**
 * Direction of a rate, read from the decimal string the venue publishes rather
 * than from a parsed float: the sign is in the first character and "0.0000" is
 * directionless however many zeros it carries.
 */
function rateTone(rate: string | null): StatTone {
  if (rate === null) return 'plain';

  const trimmed = rate.trim();

  if (!/[1-9]/u.test(trimmed)) return 'plain';
  return trimmed.startsWith('-') ? 'negative' : 'positive';
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  list: { paddingTop: spacing.xxs },
  // Uniform rows, tight but not feed-tight: label and value share a baseline and
  // every row is the same height, which is what makes a borderless list read as a
  // table rather than as loose text.
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xxs,
  },
  label: { ...typography.bodyCompact, color: colors.textSecondary },
  value: {
    ...typography.bodyCompact,
    flexShrink: 1,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  time: { color: colors.accentSoft },
  absent: { color: colors.textMuted },
  source: {
    ...typography.caption,
    marginTop: spacing.sm,
    color: colors.textMuted,
  },
});
