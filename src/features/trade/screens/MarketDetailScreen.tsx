import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { AppScreen } from '@/components/layout/AppScreen';
import { readAppConfig } from '@/config/appConfig';
import {
  addAmounts,
  formatCompactTokenPrice,
  formatCompactUsd,
} from '@/domain/money/amount';
import { FlashOrderTicket } from '@/features/trade/components/FlashOrderTicket';
import { MarketCandleChart } from '@/features/trade/components/MarketCandleChart';
import { MarketLogo } from '@/features/trade/components/MarketLogo';
import { useFlashVenueMarkets } from '@/features/trade/hooks/useFlashVenueMarkets';
import { usePythMarketHistory } from '@/features/trade/hooks/usePythMarketHistory';
import {
  MARKET_TIMEFRAMES,
  type MarketTimeframe,
} from '@/integrations/perps/markets/pythHistory';
import { listMainnetMarkets } from '@/integrations/perps/markets/mainnetCatalog';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

export function MarketDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ venueRef?: string | string[] }>();
  const rawVenueRef = Array.isArray(params.venueRef)
    ? params.venueRef[0]
    : params.venueRef;
  const market = useMemo(
    () => listMainnetMarkets().find((candidate) => candidate.venueRef === rawVenueRef),
    [rawVenueRef],
  );
  const selectedMarkets = useMemo(() => market === undefined ? [] : [market], [market]);
  const config = readAppConfig();
  const [timeframe, setTimeframe] = useState<MarketTimeframe>('5');
  const viewportWidth = useWindowDimensions().width;
  const chartWidth = Math.max(
    280,
    Math.min(viewportWidth, layout.maxContentWidth) - layout.screenPadding * 2,
  );
  const perps = config.ok ? config.value.perps : null;
  const venue = useFlashVenueMarkets(
    perps?.flashErRpc ?? '',
    perps?.flashProgramId ?? '',
    perps?.flashDataOrigin ?? '',
    perps?.flashStatsOrigin ?? '',
    selectedMarkets,
  );
  const history = usePythMarketHistory(
    perps?.pythBenchmarksOrigin ?? '',
    market?.oracleSymbol ?? '',
    timeframe,
  );

  if (market === undefined || !config.ok) {
    return (
      <AppScreen contentContainerStyle={styles.centered}>
        <EmptyState
          action={{ label: 'Back to markets', onPress: () => router.replace('/(tabs)/trade') }}
          message="This Flash market is not present in the active mainnet catalog."
          title="Market unavailable"
        />
      </AppScreen>
    );
  }

  const snapshot = venue.snapshots[0] ?? null;
  const price = snapshot !== null && !snapshot.priceStale ? snapshot.price : null;
  const openInterest = snapshot === null
    ? null
    : addAmounts(snapshot.longOpenInterest, snapshot.shortOpenInterest);

  return (
    <AppScreen contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Back to markets"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Text style={styles.backLabel}>‹</Text>
        </Pressable>
        <MarketLogo size={36} symbol={market.baseAsset} url={market.iconUrl} />
        <View style={styles.identity}>
          <View style={styles.symbolLine}>
            <Text style={styles.symbol}>{market.baseAsset}-PERP</Text>
            <View style={styles.leverageBadge}>
              <Text style={styles.leverage}>{market.maxLeverage}×</Text>
            </View>
          </View>
          <Text style={styles.name}>{market.displayName} · Flash Trade</Text>
        </View>
      </View>

      <View style={styles.marketStrip}>
        <HeadlineMetric
          label="Oracle"
          tone="neutral"
          value={price === null ? 'Unavailable' : formatCompactTokenPrice(price)}
        />
        <HeadlineMetric
          label="24h"
          tone={changeTone(snapshot?.change24hBps ?? null)}
          value={formatChange(snapshot?.change24hBps ?? null)}
        />
        <HeadlineMetric
          label="Updated"
          tone="neutral"
          value={snapshot === null ? 'Unavailable' : formatTime(snapshot.pricePublishedAtMs)}
        />
      </View>

      <View style={styles.sectionHeader}>
        <View>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Price</Text>
          <Text style={styles.source}>Pyth Benchmarks · public OHLC</Text>
        </View>
        <View accessibilityRole="tablist" style={styles.timeframes}>
          {MARKET_TIMEFRAMES.map((option) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: option.id === timeframe }}
              key={option.id}
              onPress={() => setTimeframe(option.id)}
              style={({ pressed }) => [
                styles.timeframe,
                option.id === timeframe && styles.timeframeSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={option.id === timeframe ? styles.timeframeTextSelected : styles.timeframeText}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <MarketCandleChart
        candles={history.candles}
        status={history.status}
        width={chartWidth}
      />

      <View style={styles.statsPanel}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Market data</Text>
        <Stat label="24h volume" value={snapshot?.volume24h === null || snapshot === null ? 'Unavailable' : formatCompactUsd(snapshot.volume24h)} />
        <Stat label="Open interest" value={openInterest === null ? 'Unavailable' : formatCompactUsd(openInterest)} />
        <Stat label="Long / short OI" value={snapshot === null ? 'Unavailable' : `${formatCompactUsd(snapshot.longOpenInterest)} / ${formatCompactUsd(snapshot.shortOpenInterest)}`} />
        <Stat label="Open positions" value={snapshot === null ? 'Unavailable' : String(snapshot.longOpenPositions + snapshot.shortOpenPositions)} />
        <Stat label="Maximum leverage" value={`${market.maxLeverage}×`} />
        <Text style={styles.source}>Flash ER venue state · Pyth oracle</Text>
      </View>

      <FlashOrderTicket
        baseRpcUrl={config.value.api.publicRpcUrl}
        erRpcUrl={config.value.perps.flashErRpc}
        market={market}
        programId={config.value.perps.flashProgramId}
        rpcUrl={config.value.api.rpcUrl}
        swapBuildUrl={config.value.api.swapBuildUrl}
        usdtMint={config.value.perps.usdtMint}
      />
    </AppScreen>
  );
}

function HeadlineMetric({ label, tone, value }: {
  readonly label: string;
  readonly tone: 'positive' | 'negative' | 'neutral';
  readonly value: string;
}) {
  return (
    <View style={styles.headlineMetric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text selectable style={[styles.metricValue, tone === 'positive' && styles.positive, tone === 'negative' && styles.negative]}>{value}</Text>
    </View>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text selectable style={styles.statValue}>{value}</Text>
    </View>
  );
}

function formatChange(value: number | null): string {
  if (value === null) return 'Unavailable';
  const absolute = Math.abs(value);
  return `${value >= 0 ? '+' : '-'}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}%`;
}

function changeTone(value: number | null): 'positive' | 'negative' | 'neutral' {
  if (value === null) return 'neutral';
  return value < 0 ? 'negative' : 'positive';
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  centered: { flexGrow: 1, justifyContent: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  backLabel: { ...typography.title, color: colors.textPrimary, lineHeight: 34 },
  identity: { flex: 1, minWidth: 0, gap: spacing.xxs },
  symbolLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  symbol: { ...typography.heading, color: colors.textPrimary },
  name: { ...typography.caption, color: colors.textMuted },
  leverageBadge: { paddingHorizontal: spacing.xs, borderRadius: radii.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accent },
  leverage: { ...typography.eyebrow, color: colors.accentSoft },
  marketStrip: { flexDirection: 'row', gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  headlineMetric: { flex: 1, minWidth: 0, gap: spacing.xxs },
  metricLabel: { ...typography.eyebrow, color: colors.textMuted },
  metricValue: { ...typography.label, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { ...typography.heading, color: colors.textPrimary },
  source: { ...typography.caption, color: colors.textMuted },
  timeframes: { flexDirection: 'row', gap: spacing.xxs },
  timeframe: { minWidth: 38, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm },
  timeframeSelected: { backgroundColor: colors.surfaceElevated },
  timeframeText: { ...typography.caption, color: colors.textMuted },
  timeframeTextSelected: { ...typography.caption, color: colors.accentSoft },
  statsPanel: { gap: spacing.sm, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface },
  stat: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  statLabel: { ...typography.bodyCompact, color: colors.textMuted },
  statValue: { ...typography.bodyCompact, flexShrink: 1, color: colors.textPrimary, textAlign: 'right', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.72 },
});
