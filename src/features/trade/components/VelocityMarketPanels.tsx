import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import {
  formatAmountWithCommas,
  formatCompactTokenPrice,
  formatCompactUsd,
} from '@/domain/money/amount';
import { MarketTrades } from '@/features/trade/components/PacificaMarketTrades';
import type { VelocityPublicMarketState } from '@/features/trade/hooks/useVelocityPublicMarket';
import type {
  VelocityMarket,
  VelocityMarketSnapshot,
} from '@/integrations/perps/velocity/velocityMarketData';
import { colors, spacing, typography } from '@/theme/tokens';

const UNAVAILABLE = '--.--';

export function VelocityTradesPanel({
  baseAsset,
  publicMarket,
}: {
  readonly baseAsset: string;
  readonly publicMarket: VelocityPublicMarketState;
}) {
  return (
    <View style={styles.panel}>
      <Text accessibilityLiveRegion="polite" style={styles.muted}>
        {connectionLabel(publicMarket.status, 'executions')}
      </Text>
      <MarketTrades
        baseAsset={baseAsset}
        emptyText="Waiting for the next Velocity execution."
        trades={publicMarket.trades}
      />
      <Text style={styles.source}>Source: Velocity public DLOB trade stream</Text>
    </View>
  );
}

export function VelocityLiquidationsPanel({
  baseAsset,
  publicMarket,
}: {
  readonly baseAsset: string;
  readonly publicMarket: VelocityPublicMarketState;
}) {
  const liquidations = useMemo(
    () => publicMarket.trades.filter((trade) => trade.cause.includes('liquidat')),
    [publicMarket.trades],
  );
  return (
    <View style={styles.panel}>
      <View>
        <Text style={styles.title}>Liquidations</Text>
        <Text accessibilityLiveRegion="polite" style={styles.muted}>
          {connectionLabel(publicMarket.status, 'liquidations')}
        </Text>
      </View>
      <MarketTrades
        baseAsset={baseAsset}
        emptyText="No liquidation executions have arrived in this live session."
        title={`${liquidations.length} live liquidation${liquidations.length === 1 ? '' : 's'}`}
        trades={liquidations}
      />
      <Text style={styles.source}>
        Actual DLOB executions tagged as liquidations, not estimated levels
      </Text>
    </View>
  );
}

export function VelocityFundingPanel({
  snapshot,
}: {
  readonly snapshot: VelocityMarketSnapshot | null;
}) {
  return (
    <View style={styles.panel}>
      <View>
        <Text style={styles.title}>Funding rate</Text>
        <Text style={styles.muted}>Current Velocity on-chain market state</Text>
      </View>
      <View style={styles.summary}>
        <Summary
          label="Current"
          pending={snapshot === null}
          tone={rateTone(snapshot?.fundingRatePercent ?? null)}
          value={snapshot?.fundingRatePercent ?? UNAVAILABLE}
        />
        <Summary
          label="24H average"
          pending={snapshot === null}
          tone={rateTone(snapshot?.averageFundingRate24hPercent ?? null)}
          value={snapshot?.averageFundingRate24hPercent ?? UNAVAILABLE}
        />
        <Summary
          label="Last update"
          pending={snapshot === null}
          value={formatTime(snapshot?.lastFundingAtMs ?? null)}
        />
        <Summary
          label="Next update"
          pending={snapshot === null}
          value={formatTime(snapshot?.nextFundingAtMs ?? null)}
        />
      </View>
      <Text style={styles.source}>
        Velocity does not expose public funding history through the connected feed
      </Text>
    </View>
  );
}

export function VelocityMarketInfoList({
  market,
  publicMarket,
  snapshot,
}: {
  readonly market: VelocityMarket;
  readonly publicMarket: VelocityPublicMarketState;
  readonly snapshot: VelocityMarketSnapshot | null;
}) {
  const book = publicMarket.book;
  const bestBid = book?.bids[0]?.price ?? null;
  const bestAsk = book?.asks[0]?.price ?? null;
  const pending = snapshot === null;
  return (
    <View style={styles.list}>
      <Stat
        label="Mark price"
        pending={book === null && publicMarket.status === 'loading'}
        value={book === null ? UNAVAILABLE : formatCompactTokenPrice(book.markPrice)}
      />
      <Stat
        label="Oracle price"
        pending={pending}
        value={snapshot === null ? UNAVAILABLE : formatCompactTokenPrice(snapshot.oraclePrice)}
      />
      <Stat
        label="Best bid / ask"
        pending={book === null && publicMarket.status === 'loading'}
        value={bestBid === null || bestAsk === null
          ? UNAVAILABLE
          : `$${formatAmountWithCommas(bestBid)} / $${formatAmountWithCommas(bestAsk)}`}
      />
      <Stat
        label="Open interest"
        pending={pending}
        value={snapshot === null ? UNAVAILABLE : formatCompactUsd(snapshot.openInterest)}
      />
      <Stat
        label="24H volume"
        pending={pending}
        value={snapshot === null ? UNAVAILABLE : formatCompactUsd(snapshot.volume24h)}
      />
      <Stat label="Maximum leverage" value={`${market.maxLeverage}×`} />
      <Stat label="Maintenance margin" value={marginPercent(market.maintenanceMarginBps)} />
      <Stat label="Tick size" value={`$${market.tickSize}`} />
      <Stat label="Lot size" value={`${market.lotSize} ${market.baseAsset}`} />
      <Stat label="Minimum order" value={`${market.minOrderSize} ${market.baseAsset}`} />
      <Stat label="Quote collateral" value="USDT" />
      <Stat
        label="DLOB update"
        pending={book === null && publicMarket.status === 'loading'}
        value={book === null ? UNAVAILABLE : formatTime(book.publishedAtMs)}
      />
      <Text style={styles.source}>Source: Velocity on-chain state and public DLOB</Text>
    </View>
  );
}

type Tone = 'plain' | 'positive' | 'negative';

function Summary({
  label,
  pending = false,
  tone = 'plain',
  value,
}: {
  readonly label: string;
  readonly pending?: boolean;
  readonly tone?: Tone;
  readonly value: string;
}) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.muted}>{label}</Text>
      {pending ? (
        <SkeletonText role="bodyCompact" width={78} />
      ) : (
        <Text selectable style={[styles.value, toneStyle(tone)]}>{value}</Text>
      )}
    </View>
  );
}

function Stat({
  label,
  pending = false,
  value,
}: {
  readonly label: string;
  readonly pending?: boolean;
  readonly value: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      {pending ? (
        <SkeletonText align="right" role="bodyCompact" width={78} />
      ) : (
        <Text
          numberOfLines={1}
          selectable
          style={[styles.statValue, value === UNAVAILABLE && styles.absent]}
        >
          {value}
        </Text>
      )}
    </View>
  );
}

function connectionLabel(
  status: VelocityPublicMarketState['status'],
  feed: string,
): string {
  if (status === 'live') return `Live Velocity ${feed}`;
  if (status === 'error') return `Velocity ${feed} unavailable`;
  if (status === 'reconnecting') return `Reconnecting to Velocity ${feed}`;
  return `Connecting to Velocity ${feed}`;
}

function rateTone(value: string | null): Tone {
  if (value === null || !/[1-9]/u.test(value)) return 'plain';
  return value.startsWith('-') ? 'negative' : 'positive';
}

function toneStyle(tone: Tone) {
  if (tone === 'positive') return styles.positive;
  if (tone === 'negative') return styles.negative;
  return styles.plain;
}

function marginPercent(value: number): string {
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, '0');
  return `${whole}.${fraction}%`;
}

function formatTime(value: number | null): string {
  return value === null ? UNAVAILABLE : new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, paddingTop: spacing.xs },
  title: { ...typography.heading, color: colors.textPrimary },
  muted: { ...typography.caption, color: colors.textMuted },
  source: { ...typography.caption, color: colors.textMuted },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryItem: { minWidth: '46%', flexGrow: 1, gap: spacing.xxs },
  value: { ...typography.label, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  plain: { color: colors.textPrimary },
  list: { paddingTop: spacing.xxs },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.xxs,
  },
  statLabel: { ...typography.bodyCompact, color: colors.textSecondary },
  statValue: {
    ...typography.bodyCompact,
    flexShrink: 1,
    color: colors.textPrimary,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  absent: { color: colors.textMuted },
});
