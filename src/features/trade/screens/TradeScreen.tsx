import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig, type PerpsProviderId } from '@/config/appConfig';
import { formatAmount, type Amount } from '@/domain/money/amount';
import { useVelocityVenueMarkets } from '@/features/trade/hooks/useVelocityVenueMarkets';
import { usePublicMarkets } from '@/features/trade/hooks/usePublicMarkets';
import type { VelocityMarketSnapshot } from '@/integrations/perps/velocity/velocityMarketData';
import {
  listMainnetMarkets,
  type MainnetMarket,
} from '@/integrations/perps/markets/mainnetCatalog';
import type { PublicMarketPrice } from '@/integrations/perps/markets/publicMarketData';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

export function TradeScreen() {
  const config = readAppConfig();
  const preferences = useAppPreferences();
  const provider = preferences.selectedPerpsProvider;
  const markets = useMemo(() => listMainnetMarkets(provider), [provider]);
  const marketDataUrl = config.ok ? config.value.api.marketDataUrl : '';
  const marketStreamUrl = config.ok ? config.value.api.marketStreamUrl : '';
  const publicRpcUrl = config.ok ? config.value.api.publicRpcUrl : '';
  const velocityProgramId = config.ok ? config.value.perps.velocityProgramId : '';
  const publicMarkets = usePublicMarkets(marketDataUrl, marketStreamUrl);
  const venueMarkets = useVelocityVenueMarkets(
    provider,
    publicRpcUrl,
    velocityProgramId,
    markets,
    publicMarkets.prices,
  );
  const prices = useMemo(
    () => new Map(publicMarkets.prices.map((price) => [price.symbol, price])),
    [publicMarkets.prices],
  );
  const venueSnapshots = useMemo(
    () => new Map(venueMarkets.snapshots.map((market) => [market.symbol, market])),
    [venueMarkets.snapshots],
  );

  return (
    <AppScreen>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Markets
          </Text>
          <Text style={styles.subtitle}>Solana mainnet perpetuals</Text>
        </View>

        <View style={styles.providerPanel}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Trading provider
          </Text>
          <View style={styles.providerButtons}>
            <View style={styles.providerButton}>
              <ProviderButton
                label="Flash Trade v2"
                provider="flash"
                selected={provider}
                select={preferences.selectPerpsProvider}
              />
            </View>
            <View style={styles.providerButton}>
              <ProviderButton
                label="Velocity"
                provider="velocity"
                selected={provider}
                select={preferences.selectPerpsProvider}
              />
            </View>
          </View>
          <StatusRow label="Network" value="Solana mainnet" />
          <StatusRow
            label="Market access"
            value="Public · no wallet signature"
          />
          <StatusRow
            label="Price feed"
            value={
              publicMarkets.streamState === 'live'
                ? 'Live · Pyth stream'
                : publicMarkets.streamState === 'connecting'
                  ? 'Connecting · REST snapshot active'
                  : 'Reconnecting · latest price retained'
            }
          />
          <StatusRow
            label="Venue data"
            value={venueStatus(provider, venueMarkets.status, venueMarkets.snapshots)}
          />
        </View>

        {publicMarkets.status === 'loading' ? (
          <View accessibilityLabel="Loading mainnet markets" style={styles.loading}>
            <IOSLoader size="large" />
          </View>
        ) : null}

        {publicMarkets.status === 'error' ? (
          <View accessibilityRole="alert" style={styles.errorPanel}>
            <Text style={styles.errorTitle}>Markets unavailable</Text>
            <Text style={styles.note}>
              Check your connection and retry. Wallet access is not involved.
            </Text>
            <Button
              label="Retry market data"
              onPress={() => void publicMarkets.refresh()}
              variant="secondary"
            />
          </View>
        ) : null}

        <View style={styles.marketList}>
          {markets.map((market) => (
            <MarketCard
              key={market.symbol}
              market={market}
              price={prices.get(market.symbol) ?? null}
              venue={venueSnapshots.get(market.symbol) ?? null}
            />
          ))}
        </View>

        <Text style={styles.footerNote}>
          {provider === 'flash'
            ? 'Flash venue metrics require the mainnet ER trading endpoint supplied by Flash. Pyth reference prices remain live and need no wallet.'
            : 'Velocity mark, bid, ask, funding, risk, and volume come from live mainnet market accounts. Pyth provides the current oracle input.'}
        </Text>
      </View>
    </AppScreen>
  );
}

function ProviderButton({
  label,
  provider,
  selected,
  select,
}: {
  readonly label: string;
  readonly provider: PerpsProviderId;
  readonly selected: PerpsProviderId;
  readonly select: (provider: PerpsProviderId) => void;
}) {
  return (
    <Button
      label={label}
      onPress={() => select(provider)}
      variant={selected === provider ? 'primary' : 'secondary'}
    />
  );
}

function MarketCard({
  market,
  price,
  venue,
}: {
  readonly market: MainnetMarket;
  readonly price: PublicMarketPrice | null;
  readonly venue: VelocityMarketSnapshot | null;
}) {
  const headlinePrice = venue?.markPrice ?? price?.price ?? null;

  return (
    <View style={styles.marketCard}>
      <View style={styles.marketHeader}>
        <View>
          <Text accessibilityRole="header" style={styles.marketSymbol}>
            {market.symbol}
          </Text>
          <Text style={styles.providerLabel}>
            {venue === null
              ? `${market.providerLabel} · Pyth reference`
              : `${market.providerLabel} · mark price`}
          </Text>
        </View>
        <Text style={styles.marketPrice}>
          {headlinePrice === null ? '—' : `$${formatMarketAmount(headlinePrice)}`}
        </Text>
      </View>
      {venue === null ? (
        <ReferenceRows market={market} price={price} />
      ) : (
        <VenueRows price={price} venue={venue} />
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
        value={
          price === null ? '—' : `±$${formatMarketAmount(price.confidence)}`
        }
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

function VenueRows({
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
          price === null ? '—' : `$${formatMarketAmount(price.price)} · Pyth`
        }
      />
      <StatusRow
        label="Bid / ask"
        value={`$${formatMarketAmount(venue.bidPrice)} / $${formatMarketAmount(venue.askPrice)}`}
      />
      <StatusRow
        label="Funding / hour"
        value={venue.fundingLabel ?? 'Unavailable'}
      />
      <StatusRow
        label="24h volume"
        value={`$${formatMarketAmount(venue.volume24h)}`}
      />
      <StatusRow
        label="Initial margin"
        value={`${formatBasisPoints(venue.initialMarginBps)}%`}
      />
      <StatusRow label="Venue slot" value={venue.slot.toLocaleString()} />
    </>
  );
}

function venueStatus(
  provider: PerpsProviderId,
  status: 'idle' | 'loading' | 'ready' | 'error',
  snapshots: readonly VelocityMarketSnapshot[],
): string {
  if (provider === 'flash') {
    return 'Reference prices · ER endpoint required';
  }

  if (status === 'ready') {
    return `Live · slot ${snapshots[0]?.slot.toLocaleString() ?? '—'}`;
  }

  return status === 'error' ? 'Retrying on-chain accounts' : 'Loading on-chain accounts';
}

function priceFreshness(price: PublicMarketPrice | null): string {
  if (price === null) {
    return 'Loading';
  }

  return price.stale
    ? 'Delayed feed'
    : new Date(price.publishedAtMs).toLocaleTimeString();
}

function formatMarketAmount(amount: Amount): string {
  const [whole = '0', fraction] = formatAmount(amount).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');

  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function formatBasisPoints(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = (basisPoints % 100).toString().padStart(2, '0').replace(/0+$/u, '');

  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  header: {
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyCompact,
    marginTop: spacing.xxs,
    color: colors.textSecondary,
  },
  providerPanel: {
    gap: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  providerButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  providerButton: {
    flex: 1,
  },
  loading: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorPanel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  errorTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  note: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
  marketList: {
    gap: spacing.md,
  },
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
  marketSymbol: {
    ...typography.heading,
    color: colors.textPrimary,
  },
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
  footerNote: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
});
