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
        <Text accessibilityRole="header" style={styles.marketSymbol}>
          {market.symbol}
        </Text>
        <Text style={styles.marketPrice}>
          {headlinePrice === null ? '—' : formatCompactTokenPrice(headlinePrice)}
        </Text>
      </View>
      {velocityVenue !== null ? (
        <VelocityVenueRows market={market} venue={velocityVenue} />
      ) : flashVenue !== null ? (
        <FlashVenueRows market={market} venue={flashVenue} />
      ) : (
        <ReferenceRows market={market} />
      )}
      {onTrade === undefined ? null : (
        <Button
          label="Trade"
          onPress={onTrade}
          variant="secondary"
        />
      )}
    </View>
  );
}

function ReferenceRows({
  market,
}: {
  readonly market: MainnetMarket;
}) {
  return (
    <>
      <StatusRow
        label="Max leverage"
        value={
          market.maxLeverage === null
            ? 'Loading provider risk'
            : `Up to ${market.maxLeverage}×`
        }
      />
      <StatusRow label="Provider data" value="Connecting" />
    </>
  );
}

function VelocityVenueRows({
  market,
  venue,
}: {
  readonly market: MainnetMarket;
  readonly venue: VelocityMarketSnapshot;
}) {
  return (
    <>
      <StatusRow
        label="Funding / hour"
        value={venue.fundingLabel ?? 'Unavailable'}
      />
      <StatusRow label="24h volume" value={formatCompactUsd(venue.volume24h)} />
      <StatusRow
        label="Max leverage"
        value={market.maxLeverage === null ? '—' : `${market.maxLeverage}×`}
      />
    </>
  );
}

function FlashVenueRows({
  market,
  venue,
}: {
  readonly market: MainnetMarket;
  readonly venue: FlashMarketSnapshot;
}) {
  return (
    <>
      <StatusRow
        label="Long / short OI"
        value={`${formatCompactUsd(venue.longOpenInterest)} / ${formatCompactUsd(venue.shortOpenInterest)}`}
      />
      <StatusRow
        label="Max leverage"
        value={market.maxLeverage === null ? '—' : `${market.maxLeverage}×`}
      />
    </>
  );
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
  marketPrice: {
    ...typography.heading,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
});
