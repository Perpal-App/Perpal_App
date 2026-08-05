import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import {
  formatCompactTokenPrice,
  formatCompactUsd,
} from '@/domain/money/amount';
import type { FlashMarketSnapshot } from '@/integrations/perps/flash/flashMarketData';
import type { MainnetMarket } from '@/integrations/perps/markets/mainnetCatalog';
import type { PublicMarketPrice } from '@/integrations/perps/markets/publicMarketData';
import type { VelocityMarketSnapshot } from '@/integrations/perps/velocity/velocityMarketData';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export function MarketCard({
  market,
  price,
  flashVenue,
  velocityVenue,
  onTrade,
}: {
  readonly market: MainnetMarket;
  readonly price: PublicMarketPrice | null;
  readonly flashVenue: FlashMarketSnapshot | null;
  readonly velocityVenue: VelocityMarketSnapshot | null;
  readonly onTrade?: () => void;
}) {
  const headlinePrice = velocityVenue?.markPrice ?? price?.price ?? null;

  return (
    <View style={styles.marketCard}>
      <View style={styles.marketHeader}>
        <View>
          <Text accessibilityRole="header" style={styles.marketSymbol}>
            {market.symbol}
          </Text>
          <Text style={styles.providerLabel}>
            {velocityVenue !== null
              ? `${market.providerLabel} · mark price`
              : flashVenue !== null
                ? `${market.providerLabel} · live ER`
                : `${market.providerLabel} · Pyth reference`}
          </Text>
        </View>
        <Text style={styles.marketPrice}>
          {headlinePrice === null ? '—' : formatCompactTokenPrice(headlinePrice)}
        </Text>
      </View>
      {velocityVenue !== null ? (
        <VelocityVenueRows price={price} venue={velocityVenue} />
      ) : flashVenue !== null ? (
        <FlashVenueRows market={market} price={price} venue={flashVenue} />
      ) : (
        <ReferenceRows market={market} price={price} />
      )}
      {onTrade === undefined ? null : (
        <Button
          label={`Trade ${market.symbol}`}
          onPress={onTrade}
          variant="secondary"
        />
      )}
    </View>
  );
}

function ReferenceRows({
  market,
  price,
}: {
  readonly market: MainnetMarket;
  readonly price: PublicMarketPrice | null;
}) {
  return (
    <>
      <StatusRow
        label="Confidence"
        value={price === null ? '—' : `±${formatCompactUsd(price.confidence)}`}
      />
      <StatusRow label="Updated" value={priceFreshness(price)} />
      <StatusRow
        label="Max leverage"
        value={
          market.maxLeverage === null
            ? 'Loading provider risk'
            : `Up to ${market.maxLeverage}×`
        }
      />
      <StatusRow label="Price source" value={price?.source ?? 'Pyth Hermes'} />
    </>
  );
}

function VelocityVenueRows({
  price,
  venue,
}: {
  readonly price: PublicMarketPrice | null;
  readonly venue: VelocityMarketSnapshot;
}) {
  return (
    <>
      <StatusRow
        label="Oracle"
        value={
          price === null
            ? '—'
            : `${formatCompactTokenPrice(price.price)} · Pyth`
        }
      />
      <StatusRow
        label="Bid / ask"
        value={`${formatCompactTokenPrice(venue.bidPrice)} / ${formatCompactTokenPrice(venue.askPrice)}`}
      />
      <StatusRow
        label="Funding / hour"
        value={venue.fundingLabel ?? 'Unavailable'}
      />
      <StatusRow label="24h volume" value={formatCompactUsd(venue.volume24h)} />
      <StatusRow
        label="Initial margin"
        value={`${formatBasisPoints(venue.initialMarginBps)}%`}
      />
      <StatusRow label="Venue slot" value={venue.slot.toLocaleString()} />
    </>
  );
}

function FlashVenueRows({
  market,
  price,
  venue,
}: {
  readonly market: MainnetMarket;
  readonly price: PublicMarketPrice | null;
  readonly venue: FlashMarketSnapshot;
}) {
  return (
    <>
      <StatusRow
        label="Oracle"
        value={
          price === null
            ? '—'
            : `${formatCompactTokenPrice(price.price)} · Pyth`
        }
      />
      <StatusRow
        label="Long / short OI"
        value={`${formatCompactUsd(venue.longOpenInterest)} / ${formatCompactUsd(venue.shortOpenInterest)}`}
      />
      <StatusRow
        label="Open positions"
        value={`${venue.longOpenPositions.toLocaleString()} / ${venue.shortOpenPositions.toLocaleString()}`}
      />
      <StatusRow
        label="Max leverage"
        value={market.maxLeverage === null ? '—' : `${market.maxLeverage}×`}
      />
      <StatusRow label="ER slot" value={venue.slot.toLocaleString()} />
    </>
  );
}

function priceFreshness(price: PublicMarketPrice | null): string {
  if (price === null) return 'Loading';
  return price.stale
    ? 'Delayed feed'
    : new Date(price.publishedAtMs).toLocaleTimeString();
}

function formatBasisPoints(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = (basisPoints % 100)
    .toString()
    .padStart(2, '0')
    .replace(/0+$/u, '');
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

const styles = StyleSheet.create({
  marketCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  marketHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  marketSymbol: { ...typography.heading, color: colors.textPrimary },
  providerLabel: {
    ...typography.bodyCompact,
    marginTop: spacing.xxs,
    color: colors.textMuted,
  },
  marketPrice: {
    ...typography.heading,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
});
