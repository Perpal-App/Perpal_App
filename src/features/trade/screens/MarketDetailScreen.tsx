import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { AppScreen } from '@/components/layout/AppScreen';
import { UnderlineTabs, type UnderlineTabOption } from '@/components/ui/UnderlineTabs';
import { readAppConfig } from '@/config/appConfig';
import {
  formatCompactTokenPrice,
  formatCompactUsd,
} from '@/domain/money/amount';
import { PacificaOrderTicket } from '@/features/trade/components/PacificaOrderTicket';
import { MarketLogo } from '@/features/trade/components/MarketLogo';
import { TradingViewMarketChart } from '@/features/trade/components/TradingViewMarketChart';
import { usePacificaMarkets } from '@/features/trade/hooks/usePacificaMarkets';
import { usePacificaMarketHistory } from '@/features/trade/hooks/usePacificaMarketHistory';
import type { PacificaOrderSide } from '@/integrations/perps/pacifica/pacificaOrder';
import type { MarketTimeframe } from '@/integrations/perps/pacifica/pacificaHistory';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

/** Placeholder shape shared with the markets table and the order ticket. */
const UNAVAILABLE = '--.--';

const SECTIONS: readonly UnderlineTabOption[] = [
  { id: 'chart', label: 'Chart' },
  { id: 'info', label: 'Market info' },
];

/**
 * One perpetual, in the order a trader reads it: what it is and what it costs,
 * the venue's headline figures, the chart, then the ticket.
 *
 * The instrument header and the figure strip stay put while the section below
 * swaps, so switching from the chart to market data never moves the price you
 * are watching. Order entry stays behind the Long and Short controls at the
 * bottom — nothing on this screen can submit without opening the ticket first.
 */
export function MarketDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ venueRef?: string | string[] }>();
  const rawVenueRef = Array.isArray(params.venueRef)
    ? params.venueRef[0]
    : params.venueRef;
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
  const [timeframe, setTimeframe] = useState<MarketTimeframe>('15m');
  const [section, setSection] = useState('chart');
  const [orderSide, setOrderSide] = useState<PacificaOrderSide | null>(null);
  const history = usePacificaMarketHistory(
    perps?.pacificaApiOrigin ?? '',
    market?.venueRef ?? '',
    timeframe,
  );

  if (market === undefined || !config.ok) {
    return (
      <AppScreen contentContainerStyle={styles.centered}>
        <EmptyState
          action={{ label: 'Back to markets', onPress: () => router.replace('/(tabs)/trade') }}
          message="This Pacifica market is not present in the current public catalog."
          title="Market unavailable"
        />
      </AppScreen>
    );
  }

  const snapshot = venue.snapshots.find((candidate) => candidate.venueRef === market.venueRef) ?? null;
  const price = snapshot !== null && !snapshot.priceStale ? snapshot.price : null;
  const change = snapshot?.change24hBps ?? null;
  const openInterest = snapshot?.openInterest ?? null;

  return (
    <AppScreen contentContainerStyle={styles.content}>
      <View style={styles.instrument}>
        <Pressable
          accessibilityLabel="Back to markets"
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
            <Text numberOfLines={1} style={styles.symbol}>
              {market.baseAsset}-USD Perps
            </Text>
            <View style={styles.leverageBadge}>
              <Text style={styles.leverage}>{market.maxLeverage}×</Text>
            </View>
          </View>
          <Text numberOfLines={1} style={styles.name}>{market.displayName}</Text>
        </View>
        <View style={styles.priceSummary}>
          <Text numberOfLines={1} selectable style={styles.price}>
            {price === null ? UNAVAILABLE : formatCompactTokenPrice(price)}
          </Text>
          <Text numberOfLines={1} style={[styles.change, toneStyle(change)]}>
            {formatChange(change)}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.figureStrip}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <Figure label="VENUE" value="Pacifica" />
        <Figure
          label="24H VOL"
          value={snapshot?.volume24h == null ? UNAVAILABLE : formatCompactUsd(snapshot.volume24h)}
        />
        <Figure
          label="OI"
          value={openInterest === null ? UNAVAILABLE : formatCompactUsd(openInterest)}
        />
        <Figure label="ORACLE" value={snapshot === null ? UNAVAILABLE : formatCompactTokenPrice(snapshot.oraclePrice)} />
        <Figure label="FUNDING" value={snapshot === null ? UNAVAILABLE : funding(snapshot.fundingRate)} />
      </ScrollView>

      <UnderlineTabs onSelect={setSection} options={SECTIONS} selectedId={section} />

      {section === 'chart' ? (
        <TradingViewMarketChart
          candles={history.candles}
          onExpand={() => router.push({
            pathname: '/market-chart/[venueRef]',
            params: { venueRef: market.venueRef },
          })}
          onTimeframeChange={setTimeframe}
          status={history.status}
          symbol={`${market.baseAsset}/USD`}
          timeframe={timeframe}
        />
      ) : (
        <View style={styles.infoPanel}>
          <Stat label="Open interest" value={openInterest === null ? UNAVAILABLE : formatCompactUsd(openInterest)} />
          <Stat label="Funding rate" value={snapshot === null ? UNAVAILABLE : funding(snapshot.fundingRate)} />
          <Stat label="Next funding" value={snapshot === null ? UNAVAILABLE : funding(snapshot.nextFundingRate)} />
          <Stat label="Maximum leverage" value={`${market.maxLeverage}×`} />
          <Stat label="Instrument" value={market.venueRef} />
          <Stat
            label="Oracle update"
            value={snapshot?.pricePublishedAtMs == null
              ? UNAVAILABLE
              : formatTime(snapshot.pricePublishedAtMs)}
          />
          <Text style={styles.source}>
            Pacifica mark, oracle, funding, volume, open interest, and mark candles
            are read directly from Pacifica's public API. The executable order is
            revalidated against a fresh mark before T signs.
          </Text>
        </View>
      )}

      {orderSide === null ? (
        <View style={styles.actionBar}>
          <SideButton onPress={() => setOrderSide('long')} side="long" />
          <SideButton onPress={() => setOrderSide('short')} side="short" />
        </View>
      ) : (
        <View style={styles.ticket}>
          {snapshot === null ? (
            <Text accessibilityRole="alert" style={styles.source}>A current Pacifica mark is required before trading.</Text>
          ) : <PacificaOrderTicket
            apiOrigin={config.value.perps.pacificaApiOrigin}
            centralState={config.value.perps.pacificaCentralState}
            initialSide={orderSide}
            market={market}
            programId={config.value.perps.pacificaProgramId}
            rpcUrl={config.value.api.rpcUrl}
            snapshot={snapshot}
            swapBuildUrl={config.value.api.swapBuildUrl}
            usdcMint={config.value.perps.usdcMint}
            usdtMint={config.value.perps.usdtMint}
            vault={config.value.perps.pacificaVault}
          />}
          <Pressable
            accessibilityRole="button"
            onPress={() => setOrderSide(null)}
            style={({ pressed }) => [styles.hide, pressed && styles.pressed]}
          >
            <Text style={styles.hideLabel}>Hide order ticket</Text>
          </Pressable>
        </View>
      )}
    </AppScreen>
  );
}

function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text
        numberOfLines={1}
        selectable
        style={[styles.figureValue, value === UNAVAILABLE && styles.absent]}
      >
        {value}
      </Text>
    </View>
  );
}

function SideButton({
  onPress,
  side,
}: {
  readonly onPress: () => void;
  readonly side: PacificaOrderSide;
}) {
  const long = side === 'long';

  return (
    <Pressable
      accessibilityHint="Opens the order ticket on this side"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.sideButton,
        long ? styles.longButton : styles.shortButton,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.sideLabel, long ? styles.onLong : styles.onShort]}>
        {long ? 'Buy / Long' : 'Sell / Short'}
      </Text>
    </Pressable>
  );
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text selectable style={[styles.statValue, value === UNAVAILABLE && styles.absent]}>
        {value}
      </Text>
    </View>
  );
}

function formatChange(value: number | null): string {
  if (value === null) return UNAVAILABLE;
  const absolute = Math.abs(value);
  return `${value >= 0 ? '+' : '-'}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}%`;
}

function funding(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${(parsed * 100).toFixed(4)}%` : UNAVAILABLE;
}

function toneStyle(value: number | null) {
  if (value === null) return styles.absent;
  return value < 0 ? styles.negative : styles.positive;
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
    gap: spacing.sm,
  },
  centered: { flexGrow: 1, justifyContent: 'center' },
  instrument: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  back: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    marginLeft: -spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: { ...typography.title, color: colors.textPrimary, lineHeight: 34 },
  identity: { flex: 1, minWidth: 0 },
  symbolLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  symbol: { ...typography.heading, flexShrink: 1, color: colors.textPrimary },
  name: { ...typography.caption, color: colors.textMuted },
  leverageBadge: {
    flexShrink: 0,
    paddingHorizontal: spacing.xxs,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  leverage: { ...typography.eyebrow, letterSpacing: 0, color: colors.accentSoft },
  priceSummary: { flexShrink: 0, alignItems: 'flex-end' },
  price: { ...typography.label, color: colors.textPrimary },
  change: { ...typography.caption },
  // Figures sit between two rules, the same band treatment the markets table
  // uses for its column header.
  figureStrip: {
    gap: spacing.xl,
    paddingVertical: spacing.xs,
  },
  figure: { minWidth: 64 },
  figureLabel: { ...typography.eyebrow, letterSpacing: 0.5, color: colors.textMuted },
  figureValue: { ...typography.label, color: colors.textPrimary },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  absent: { color: colors.textMuted },
  infoPanel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  source: { ...typography.caption, color: colors.textMuted },
  stat: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  statLabel: { ...typography.bodyCompact, color: colors.textMuted },
  statValue: {
    ...typography.bodyCompact,
    flexShrink: 1,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  actionBar: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  sideButton: {
    flex: 1,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  longButton: { backgroundColor: colors.positive },
  shortButton: { backgroundColor: colors.negative },
  sideLabel: { ...typography.label },
  onLong: { color: colors.onLight },
  onShort: { color: colors.onAccent },
  ticket: { gap: spacing.sm },
  hide: { minHeight: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  hideLabel: { ...typography.label, color: colors.textMuted },
  pressed: { opacity: 0.72 },
});
