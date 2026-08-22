import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton, SkeletonText } from '@/components/feedback/Skeleton';
import { AppScreen } from '@/components/layout/AppScreen';
import { RiseInView } from '@/components/motion/RiseInView';
import { readAppConfig } from '@/config/appConfig';
import {
  formatAmountWithCommas,
  formatCompactTokenPrice,
  formatCompactUsd,
} from '@/domain/money/amount';
import { MarketLogo } from '@/features/trade/components/MarketLogo';
import { VelocityTradingWorkspace } from '@/features/trade/components/VelocityTradingWorkspace';
import { useVelocityMarkets } from '@/features/trade/hooks/useVelocityMarkets';
import { colors, fonts, layout, motion, radii, spacing, typography } from '@/theme/tokens';

const UNAVAILABLE = '--.--';

export function VelocityMarketDetailScreen({ venueRef }: { readonly venueRef: string }) {
  const router = useRouter();
  const compact = useWindowDimensions().width < layout.compactWidth;
  const config = readAppConfig();
  const venue = useVelocityMarkets(
    config.ok ? config.value.api.publicRpcUrl : '',
    config.ok ? config.value.perps.velocityProgramId : '',
    config.ok ? config.value.perps.pacificaAssetOrigin : '',
  );
  const market = useMemo(
    () => venue.markets.find((candidate) => candidate.venueRef === venueRef),
    [venue.markets, venueRef],
  );
  const snapshot = useMemo(
    () => venue.snapshots.find((candidate) => candidate.venueRef === venueRef) ?? null,
    [venue.snapshots, venueRef],
  );

  if (config.ok && market === undefined && venue.status !== 'ready') {
    return <Loading compact={compact} />;
  }
  if (!config.ok || market === undefined) {
    return (
      <AppScreen contentContainerStyle={styles.centered}>
        <EmptyState
          action={{ label: 'Back to markets', onPress: () => router.replace('/(tabs)/trade') }}
          message={config.ok
            ? 'This market is not present in Velocity’s current on-chain catalog.'
            : 'Market configuration is missing from this build.'}
          title="Market not found"
        />
      </AppScreen>
    );
  }

  const pending = snapshot === null;
  const pricePending = snapshot === null || snapshot.priceStale;
  const price = snapshot !== null && !snapshot.priceStale ? snapshot.price : null;

  return (
    <AppScreen contentContainerStyle={[styles.content, compact && styles.compactGutter]}>
      <RiseInView style={styles.instrument}>
        <BackButton />
        <MarketLogo size={30} symbol={market.baseAsset} url={market.iconUrl} />
        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.symbol}>{market.baseAsset}-USD</Text>
          <View style={styles.qualifier}>
            <View style={styles.leverageBadge}>
              <Text style={styles.leverage}>{market.maxLeverage}×</Text>
            </View>
            <Text numberOfLines={1} style={styles.name}>Velocity · USDT margin</Text>
          </View>
        </View>
        <View style={styles.priceSummary}>
          {pricePending ? (
            <>
              <SkeletonText align="right" role="heading" width={84} />
              <SkeletonText align="right" role="caption" width={52} />
            </>
          ) : (
            <>
              <Text numberOfLines={1} selectable style={styles.price}>
                {price === null ? UNAVAILABLE : `$${formatAmountWithCommas(price)}`}
              </Text>
              <Text numberOfLines={1} style={[styles.change, styles.live]}>Live oracle</Text>
            </>
          )}
        </View>
      </RiseInView>

      <RiseInView delay={motion.rise.stagger} style={styles.figureGrid}>
        <Figure
          label="24H VOL"
          pending={pending}
          pendingWidth={56}
          value={snapshot === null ? UNAVAILABLE : formatCompactUsd(snapshot.volume24h)}
        />
        <Figure
          label="OI"
          pending={pending}
          pendingWidth={48}
          value={snapshot === null ? UNAVAILABLE : formatCompactUsd(snapshot.openInterest)}
        />
        <Figure
          label="ORACLE"
          pending={pending}
          pendingWidth={64}
          value={snapshot === null ? UNAVAILABLE : formatCompactTokenPrice(snapshot.oraclePrice)}
        />
        <Figure
          label="FUNDING"
          pending={pending}
          pendingWidth={55}
          value={snapshot?.fundingRatePercent ?? UNAVAILABLE}
        />
        <Figure
          label="NEXT"
          pending={pending}
          pendingWidth={55}
          value={formatNextFunding(snapshot?.nextFundingAtMs ?? null)}
        />
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 2}>
        <VelocityTradingWorkspace config={config.value} market={market} snapshot={snapshot} />
      </RiseInView>
    </AppScreen>
  );
}

function Figure({
  label,
  pending,
  pendingWidth,
  value,
}: {
  readonly label: string;
  readonly pending: boolean;
  readonly pendingWidth: number;
  readonly value: string;
}) {
  return (
    <View style={styles.figure}>
      <Text numberOfLines={1} style={styles.figureLabel}>{label}</Text>
      {pending ? (
        <SkeletonText role="caption" width={pendingWidth} />
      ) : (
        <Text
          numberOfLines={1}
          selectable
          style={[styles.figureValue, value === UNAVAILABLE && styles.absent]}
        >
          {value}
        </Text>
      )}
    </View>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityLabel="Back to markets"
      accessibilityRole="button"
      hitSlop={14}
      onPress={() => router.back()}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}
    >
      <Text style={styles.backLabel}>‹</Text>
    </Pressable>
  );
}

function Loading({ compact }: { readonly compact: boolean }) {
  return (
    <AppScreen contentContainerStyle={[styles.content, compact && styles.compactGutter]}>
      <View accessibilityLabel="Loading market" accessibilityRole="progressbar" style={styles.instrument}>
        <BackButton />
        <Skeleton height={30} radius={15} width={30} />
        <View style={styles.identity}>
          <SkeletonText role="heading" width={112} />
          <SkeletonText role="caption" width={84} />
        </View>
        <View style={styles.priceSummary}>
          <SkeletonText align="right" role="heading" width={84} />
          <SkeletonText align="right" role="caption" width={52} />
        </View>
      </View>
      <View style={styles.figureGrid}>
        {[56, 48, 64, 55, 55].map((width, index) => (
          <View key={width * 100 + index} style={styles.figure}>
            <SkeletonText role="eyebrow" width={width * 0.7} />
            <SkeletonText role="caption" width={width} />
          </View>
        ))}
      </View>
      <Skeleton height={420} radius={radii.sm} />
    </AppScreen>
  );
}

function formatNextFunding(value: number | null): string {
  if (value === null) return UNAVAILABLE;
  const remainingMinutes = Math.max(0, Math.ceil((value - Date.now()) / 60_000));
  if (remainingMinutes === 0) return 'Due';
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPaddingCompact,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  compactGutter: { paddingHorizontal: spacing.xs },
  centered: { flexGrow: 1, justifyContent: 'center' },
  instrument: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  back: {
    width: 26,
    height: layout.minTouchTarget,
    marginLeft: -spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backLabel: { ...typography.title, color: colors.textPrimary, lineHeight: 34 },
  identity: { flex: 1, minWidth: 0 },
  symbol: { ...typography.heading, color: colors.textPrimary },
  qualifier: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, minWidth: 0 },
  name: { ...typography.caption, flexShrink: 1, color: colors.textMuted },
  leverageBadge: {
    flexShrink: 0,
    paddingHorizontal: spacing.xxs,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  leverage: { ...typography.eyebrow, letterSpacing: 0, color: colors.accentSoft },
  priceSummary: { flexShrink: 0, alignItems: 'flex-end' },
  price: { ...typography.label, lineHeight: typography.heading.lineHeight, color: colors.textPrimary },
  change: { ...typography.caption },
  figureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: spacing.xs,
    rowGap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  figure: { minWidth: 0 },
  figureLabel: { ...typography.eyebrow, letterSpacing: 0.5, color: colors.textMuted },
  figureValue: { ...typography.caption, fontFamily: fonts.semiBold, color: colors.textPrimary },
  absent: { color: colors.textMuted },
  live: { color: colors.positive },
  pressed: { opacity: 0.72 },
});
