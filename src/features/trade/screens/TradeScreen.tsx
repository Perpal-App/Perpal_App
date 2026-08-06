import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { readAppConfig, type PerpsProviderId } from '@/config/appConfig';
import { MarketCard } from '@/features/trade/components/MarketCard';
import { FlashOrderTicket } from '@/features/trade/components/FlashOrderTicket';
import { useFlashVenueMarkets } from '@/features/trade/hooks/useFlashVenueMarkets';
import { VelocityOrderTicket } from '@/features/trade/components/VelocityOrderTicket';
import { useVelocityVenueMarkets } from '@/features/trade/hooks/useVelocityVenueMarkets';
import { usePublicMarkets } from '@/features/trade/hooks/usePublicMarkets';
import {
  listMainnetMarkets,
  type MainnetMarket,
} from '@/integrations/perps/markets/mainnetCatalog';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

export function TradeScreen() {
  const config = readAppConfig();
  const preferences = useAppPreferences();
  const provider = preferences.selectedPerpsProvider;
  const [selectedMarket, setSelectedMarket] = useState<MainnetMarket['symbol'] | null>(null);
  const markets = useMemo(() => listMainnetMarkets(provider), [provider]);
  const marketDataUrl = config.ok ? config.value.api.marketDataUrl : '';
  const signedRpcUrl = config.ok ? config.value.api.rpcUrl : '';
  const marketStreamUrl = config.ok ? config.value.api.marketStreamUrl : '';
  const publicRpcUrl = config.ok ? config.value.api.publicRpcUrl : '';
  const velocityProgramId = config.ok ? config.value.perps.velocityProgramId : '';
  const flashProgramId = config.ok ? config.value.perps.flashProgramId : '';
  const flashErRpc = config.ok ? config.value.perps.flashErRpc : '';
  const publicMarkets = usePublicMarkets(marketDataUrl, marketStreamUrl);
  const flashMarkets = useFlashVenueMarkets(
    provider,
    flashErRpc,
    flashProgramId,
    markets,
  );
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
  const velocitySnapshots = useMemo(
    () => new Map(venueMarkets.snapshots.map((market) => [market.symbol, market])),
    [venueMarkets.snapshots],
  );
  const flashSnapshots = useMemo(
    () => new Map(flashMarkets.snapshots.map((market) => [market.symbol, market])),
    [flashMarkets.snapshots],
  );

  return (
    <AppScreen>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Markets
          </Text>
          <Text style={styles.subtitle}>Live perpetual markets</Text>
        </View>

        <View style={styles.providerPanel}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Provider
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
          <Text accessibilityLiveRegion="polite" style={styles.feedStatus}>
            {marketStatus(
              publicMarkets.streamState,
              provider === 'flash' ? flashMarkets.status : venueMarkets.status,
            )}
          </Text>
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
          {markets.map((market) => {
            const velocityVenue = velocitySnapshots.get(market.symbol) ?? null;
            return (
              <View key={market.symbol} style={styles.marketStack}>
                <MarketCard
                  market={market}
                  price={prices.get(market.symbol) ?? null}
                  flashVenue={flashSnapshots.get(market.symbol) ?? null}
                  velocityVenue={velocityVenue}
                  {...((provider === 'velocity'
                    ? velocityVenue
                    : flashSnapshots.get(market.symbol) ?? null) !== null
                    ? {
                        onTrade: () =>
                          setSelectedMarket((current) =>
                            current === market.symbol ? null : market.symbol,
                          ),
                      }
                    : {})}
                />
                {provider === 'velocity' && selectedMarket === market.symbol && velocityVenue !== null ? (
                  <VelocityOrderTicket
                    market={market}
                    marketDataUrl={marketDataUrl}
                    programId={velocityProgramId}
                    rpcUrl={signedRpcUrl}
                    venue={velocityVenue}
                  />
                ) : null}
                {provider === 'flash' && selectedMarket === market.symbol && flashSnapshots.has(market.symbol) ? (
                  <FlashOrderTicket
                    baseRpcUrl={publicRpcUrl}
                    erRpcUrl={flashErRpc}
                    market={market}
                    programId={flashProgramId}
                    rpcUrl={signedRpcUrl}
                  />
                ) : null}
              </View>
            );
          })}
        </View>

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

function marketStatus(
  stream: 'connecting' | 'live' | 'reconnecting',
  venue: 'idle' | 'loading' | 'ready' | 'error',
): string {
  if (venue === 'error') {
    return 'Prices live · provider reconnecting';
  }

  if (stream === 'live' && venue === 'ready') {
    return 'Live · Pyth prices and provider data';
  }

  return stream === 'reconnecting'
    ? 'Reconnecting · latest prices retained'
    : 'Connecting to live markets';
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
    ...typography.label,
    color: colors.textSecondary,
  },
  providerButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  providerButton: {
    flex: 1,
  },
  feedStatus: {
    ...typography.bodyCompact,
    color: colors.textMuted,
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
  marketStack: {
    gap: spacing.md,
  },
});
