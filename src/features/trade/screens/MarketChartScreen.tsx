import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { AppScreen } from '@/components/layout/AppScreen';
import { readAppConfig } from '@/config/appConfig';
import { formatCompactTokenPrice, formatCompactUsd } from '@/domain/money/amount';
import { ChartToolIcon } from '@/features/trade/components/ChartToolIcon';
import { MarketLogo } from '@/features/trade/components/MarketLogo';
import { TradingViewMarketChart } from '@/features/trade/components/TradingViewMarketChart';
import { useChartOrientation } from '@/features/trade/hooks/useChartOrientation';
import { usePacificaMarkets } from '@/features/trade/hooks/usePacificaMarkets';
import { usePacificaMarketHistory } from '@/features/trade/hooks/usePacificaMarketHistory';
import type { MarketTimeframe } from '@/integrations/perps/pacifica/pacificaHistory';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

export function MarketChartScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ venueRef?: string | string[] }>();
  const rawVenueRef = Array.isArray(params.venueRef) ? params.venueRef[0] : params.venueRef;
  const [timeframe, setTimeframe] = useState<MarketTimeframe>('15m');
  const orientation = useChartOrientation();
  const isLandscape = orientation.landscape;
  const config = readAppConfig();
  const perps = config.ok ? config.value.perps : null;
  const venue = usePacificaMarkets(
    perps?.pacificaApiOrigin ?? '',
    perps?.pacificaWsOrigin ?? '',
  );
  const market = useMemo(
    () => venue.markets.find((candidate) => candidate.venueRef === rawVenueRef),
    [rawVenueRef, venue.markets],
  );
  const history = usePacificaMarketHistory(
    perps?.pacificaApiOrigin ?? '',
    market?.venueRef ?? '',
    timeframe,
  );

  if (market === undefined || !config.ok) {
    return (
      <AppScreen contentContainerStyle={styles.centered}>
        <EmptyState
          action={{ label: 'Back', onPress: () => router.back() }}
          message="This Pacifica market is not present in the current public catalog."
          title="Chart unavailable"
        />
      </AppScreen>
    );
  }

  const snapshot = venue.snapshots.find((candidate) => candidate.venueRef === market.venueRef) ?? null;
  const price = snapshot !== null && !snapshot.priceStale ? snapshot.price : null;
  const openInterest = snapshot?.openInterest ?? null;

  return (
    <AppScreen scroll={false}>
      <View style={styles.content}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityLabel="Close full-screen chart"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <Text style={styles.backLabel}>‹</Text>
          </Pressable>
          <MarketLogo size={34} symbol={market.baseAsset} url={market.iconUrl} />
          <View style={styles.identity}>
            <View style={styles.symbolLine}>
              <Text style={styles.symbol}>{market.baseAsset}/USD</Text>
              <View style={styles.leverageBadge}>
                <Text style={styles.leverage}>{market.maxLeverage}×</Text>
              </View>
            </View>
            <Text style={styles.source}>Pacifica mark candles</Text>
          </View>
          <Metric
            label="Price / 24h"
            tone={tone(snapshot?.change24hBps ?? null)}
            value={`${price === null ? 'Unavailable' : formatCompactTokenPrice(price)}  ${formatChange(snapshot?.change24hBps ?? null)}`}
          />
          <Pressable
            accessibilityLabel={isLandscape ? 'Switch to portrait' : 'Switch to landscape'}
            accessibilityRole="button"
            accessibilityState={{ selected: isLandscape }}
            hitSlop={8}
            onPress={orientation.toggle}
            style={({ pressed }) => [
              styles.rotateToggle,
              isLandscape && styles.rotateToggleActive,
              pressed && styles.pressed,
            ]}
          >
            <ChartToolIcon
              color={isLandscape ? colors.accentSoft : colors.textSecondary}
              name="expand"
            />
          </Pressable>
          {isLandscape ? (
            <>
              <Metric label="24h volume" value={snapshot?.volume24h == null ? 'Unavailable' : formatCompactUsd(snapshot.volume24h)} />
              <Metric label="Open interest" value={openInterest === null ? 'Unavailable' : formatCompactUsd(openInterest)} />
              <Metric label="Oracle" value={snapshot === null ? 'Unavailable' : formatCompactTokenPrice(snapshot.oraclePrice)} />
            </>
          ) : null}
        </View>

        {!isLandscape ? (
          <ScrollView
            contentContainerStyle={styles.mobileMetrics}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            <Metric label="24h volume" value={snapshot?.volume24h == null ? 'Unavailable' : formatCompactUsd(snapshot.volume24h)} />
            <Metric label="Open interest" value={openInterest === null ? 'Unavailable' : formatCompactUsd(openInterest)} />
            <Metric label="Oracle" value={snapshot === null ? 'Unavailable' : formatCompactTokenPrice(snapshot.oraclePrice)} />
            <Metric label="Funding" value={snapshot === null ? 'Unavailable' : `${(Number(snapshot.fundingRate) * 100).toFixed(4)}%`} />
          </ScrollView>
        ) : null}

        <TradingViewMarketChart
          candles={history.candles}
          fill
          onTimeframeChange={setTimeframe}
          status={history.status}
          symbol={`${market.baseAsset}/USD`}
          timeframe={timeframe}
        />
        {!isLandscape ? (
          <Text style={styles.rotate}>
            Tap the expand control for landscape, or just rotate the phone.
          </Text>
        ) : null}
      </View>
    </AppScreen>
  );
}

function Metric({
  label,
  tone: valueTone = 'neutral',
  value,
}: {
  readonly label: string;
  readonly tone?: 'positive' | 'negative' | 'neutral';
  readonly value: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text selectable style={[
        styles.metricValue,
        valueTone === 'positive' && styles.positive,
        valueTone === 'negative' && styles.negative,
      ]}>{value}</Text>
    </View>
  );
}

function formatChange(value: number | null): string {
  if (value === null) return 'Unavailable';
  const absolute = Math.abs(value);
  return `${value >= 0 ? '+' : '-'}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}%`;
}

function tone(value: number | null): 'positive' | 'negative' | 'neutral' {
  if (value === null) return 'neutral';
  return value < 0 ? 'negative' : 'positive';
}

const styles = StyleSheet.create({
  centered: { flexGrow: 1, justifyContent: 'center' },
  content: { flex: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: spacing.xs },
  topBar: { minHeight: layout.minTouchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  back: { width: layout.minTouchTarget, height: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.surface },
  backLabel: { ...typography.title, color: colors.textPrimary, lineHeight: 34 },
  identity: { flex: 1, minWidth: 0, gap: spacing.xxs },
  symbolLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  symbol: { ...typography.heading, color: colors.textPrimary },
  leverageBadge: { paddingHorizontal: spacing.xs, borderRadius: radii.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.accent },
  leverage: { ...typography.eyebrow, color: colors.accentSoft },
  source: { ...typography.caption, color: colors.textMuted },
  metric: { minWidth: 112, maxWidth: 210, gap: spacing.xxs },
  metricLabel: { ...typography.eyebrow, color: colors.textMuted },
  metricValue: { ...typography.label, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  mobileMetrics: { gap: spacing.xxl, paddingHorizontal: spacing.xxs, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  rotate: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  rotateToggle: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  rotateToggleActive: { backgroundColor: colors.surfaceElevated },
  pressed: { opacity: 0.72 },
});
