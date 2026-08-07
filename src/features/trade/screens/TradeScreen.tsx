import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { readAppConfig } from '@/config/appConfig';
import { FlashOrderTicket } from '@/features/trade/components/FlashOrderTicket';
import { MarketCard } from '@/features/trade/components/MarketCard';
import { useFlashVenueMarkets } from '@/features/trade/hooks/useFlashVenueMarkets';
import { usePublicMarkets } from '@/features/trade/hooks/usePublicMarkets';
import {
  listMainnetMarkets,
} from '@/integrations/perps/markets/mainnetCatalog';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

export function TradeScreen() {
  const config = readAppConfig();
  const markets = useMemo(() => listMainnetMarkets(), []);
  const poolNames = useMemo(
    () => [...new Set(markets.map((market) => market.poolName))],
    [markets],
  );
  const [selectedPool, setSelectedPool] = useState(poolNames[0] ?? 'Crypto.1');
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const visibleMarkets = useMemo(
    () => markets.filter((market) => market.poolName === selectedPool),
    [markets, selectedPool],
  );
  const marketDataUrl = config.ok ? config.value.api.marketDataUrl : '';
  const signedRpcUrl = config.ok ? config.value.api.rpcUrl : '';
  const marketStreamUrl = config.ok ? config.value.api.marketStreamUrl : '';
  const publicRpcUrl = config.ok ? config.value.api.publicRpcUrl : '';
  const flashProgramId = config.ok ? config.value.perps.flashProgramId : '';
  const flashErRpc = config.ok ? config.value.perps.flashErRpc : '';
  const usdtMint = config.ok ? config.value.perps.usdtMint : '';
  const swapBuildUrl = config.ok ? config.value.api.swapBuildUrl : '';
  const publicMarkets = usePublicMarkets(marketDataUrl, marketStreamUrl, config.ok);
  const flashMarkets = useFlashVenueMarkets(
    flashErRpc,
    flashProgramId,
    visibleMarkets,
  );
  const prices = useMemo(
    () => new Map(publicMarkets.prices.map((price) => [price.symbol, price])),
    [publicMarkets.prices],
  );
  const flashSnapshots = useMemo(
    () => new Map(flashMarkets.snapshots.map((market) => [market.venueRef, market])),
    [flashMarkets.snapshots],
  );

  return (
    <AppScreen>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>Markets</Text>
          <Text style={styles.subtitle}>Flash Trade v2 perpetuals</Text>
        </View>

        <View style={styles.poolPanel}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Market group</Text>
          <View style={styles.poolButtons}>
            {poolNames.map((poolName) => (
              <View key={poolName} style={styles.poolButton}>
                <Button
                  label={poolLabel(poolName)}
                  onPress={() => {
                    setSelectedMarket(null);
                    setSelectedPool(poolName);
                  }}
                  variant={selectedPool === poolName ? 'primary' : 'secondary'}
                />
              </View>
            ))}
          </View>
          <Text accessibilityLiveRegion="polite" style={styles.feedStatus}>
            {marketStatus(publicMarkets.streamState, flashMarkets.status)}
          </Text>
        </View>

        {flashMarkets.status === 'loading' ? (
          <View accessibilityLabel="Loading Flash markets" style={styles.loading}>
            <IOSLoader size="large" />
          </View>
        ) : null}

        {flashMarkets.status === 'error' ? (
          <View accessibilityRole="alert" style={styles.errorPanel}>
            <Text style={styles.errorTitle}>Flash markets unavailable</Text>
            <Text style={styles.note}>The public Flash endpoint is reconnecting automatically.</Text>
          </View>
        ) : null}

        {publicMarkets.status === 'error' && flashMarkets.status === 'ready' ? (
          <Text accessibilityRole="alert" style={styles.note}>
            Reference prices are reconnecting. Flash risk and the final trade quote remain authoritative.
          </Text>
        ) : null}

        <View style={styles.marketList}>
          {visibleMarkets.map((market) => {
            const flashVenue = flashSnapshots.get(market.venueRef) ?? null;
            return (
              <View key={market.venueRef} style={styles.marketStack}>
                <MarketCard
                  flashVenue={flashVenue}
                  market={market}
                  {...(flashVenue === null
                    ? {}
                    : { onTrade: () => setSelectedMarket((current) =>
                        current === market.venueRef ? null : market.venueRef,
                      ) })}
                  price={prices.get(market.symbol) ?? null}
                />
                {selectedMarket === market.venueRef && flashVenue !== null ? (
                  <FlashOrderTicket
                    baseRpcUrl={publicRpcUrl}
                    erRpcUrl={flashErRpc}
                    market={market}
                    programId={flashProgramId}
                    rpcUrl={signedRpcUrl}
                    swapBuildUrl={swapBuildUrl}
                    usdtMint={usdtMint}
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

function poolLabel(poolName: string): string {
  return poolName.replace(/\.\d+$/u, '');
}

function marketStatus(
  stream: 'connecting' | 'live' | 'reconnecting',
  venue: 'idle' | 'loading' | 'ready' | 'error',
): string {
  if (venue === 'error') return 'Flash venue reconnecting';
  if (stream === 'live' && venue === 'ready') return 'Live · Flash venue and Pyth references';
  if (venue === 'ready') return 'Live · Flash venue';
  return stream === 'reconnecting'
    ? 'Reconnecting · latest data retained'
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
  header: { paddingVertical: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.bodyCompact, marginTop: spacing.xxs, color: colors.textSecondary },
  poolPanel: {
    gap: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sectionTitle: { ...typography.label, color: colors.textSecondary },
  poolButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  poolButton: { minWidth: 112, flexGrow: 1 },
  feedStatus: { ...typography.bodyCompact, color: colors.textMuted },
  loading: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  errorPanel: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  errorTitle: { ...typography.heading, color: colors.textPrimary },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
  marketList: { gap: spacing.md },
  marketStack: { gap: spacing.md },
});
