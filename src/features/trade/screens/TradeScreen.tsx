import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig, type PerpsProviderId } from '@/config/appConfig';
import { MarketCard } from '@/features/trade/components/MarketCard';
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
  const [selectedVelocityMarket, setSelectedVelocityMarket] = useState<MainnetMarket['symbol'] | null>(null);
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
            value={
              provider === 'flash'
                ? venueStatus(flashMarkets.status, flashMarkets.snapshots, 'ER')
                : venueStatus(venueMarkets.status, venueMarkets.snapshots, 'account')
            }
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
          {markets.map((market) => {
            const velocityVenue = velocitySnapshots.get(market.symbol) ?? null;
            return (
              <View key={market.symbol} style={styles.marketStack}>
                <MarketCard
                  market={market}
                  price={prices.get(market.symbol) ?? null}
                  flashVenue={flashSnapshots.get(market.symbol) ?? null}
                  velocityVenue={velocityVenue}
                  {...(provider === 'velocity' && velocityVenue !== null
                    ? {
                        onTrade: () =>
                          setSelectedVelocityMarket((current) =>
                            current === market.symbol ? null : market.symbol,
                          ),
                      }
                    : {})}
                />
                {selectedVelocityMarket === market.symbol && velocityVenue !== null ? (
                  <VelocityOrderTicket
                    market={market}
                    marketDataUrl={marketDataUrl}
                    programId={velocityProgramId}
                    rpcUrl={signedRpcUrl}
                    venue={velocityVenue}
                  />
                ) : null}
              </View>
            );
          })}
        </View>

        <Text style={styles.footerNote}>
          {provider === 'flash'
            ? 'Flash open interest and position counts come from live ER market accounts. Pyth remains the public oracle price source.'
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

function venueStatus(
  status: 'idle' | 'loading' | 'ready' | 'error',
  snapshots: readonly { readonly slot: number }[],
  source: 'ER' | 'account',
): string {
  if (status === 'ready') {
    return `Live · ${source} slot ${snapshots[0]?.slot.toLocaleString() ?? '—'}`;
  }

  return status === 'error' ? 'Retrying venue accounts' : 'Loading venue accounts';
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
  marketStack: {
    gap: spacing.md,
  },
  footerNote: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
});
