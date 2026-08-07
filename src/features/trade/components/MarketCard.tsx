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
import { colors, radii, spacing, typography } from '@/theme/tokens';

export function MarketCard({
  market,
  price,
  flashVenue,
  onTrade,
}: {
  readonly market: MainnetMarket;
  readonly price: PublicMarketPrice | null;
  readonly flashVenue: FlashMarketSnapshot | null;
  readonly onTrade?: () => void;
}) {
  return (
    <View style={styles.marketCard}>
      <View style={styles.marketHeader}>
        <Text accessibilityRole="header" style={styles.marketSymbol}>
          {market.symbol}
        </Text>
        <Text style={styles.marketPrice}>
          {price === null ? 'Quote on review' : formatCompactTokenPrice(price.price)}
        </Text>
      </View>
      {flashVenue !== null ? (
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
        value={`Up to ${market.maxLeverage}×`}
      />
      <StatusRow label="Provider data" value="Connecting" />
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
        value={`${market.maxLeverage}×`}
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
