import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton, SkeletonText } from '@/components/feedback/Skeleton';
import { AppScreen } from '@/components/layout/AppScreen';
import { readAppConfig } from '@/config/appConfig';
import {
  formatAmountWithCommas,
  formatCompactUsd,
} from '@/domain/money/amount';
import { MarketLogo } from '@/features/trade/components/MarketLogo';
import { VelocityOrderTicket } from '@/features/trade/components/VelocityOrderTicket';
import { useVelocityMarkets } from '@/features/trade/hooks/useVelocityMarkets';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

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
            : 'Market configuration is unavailable in this build.'}
          title="Market unavailable"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen contentContainerStyle={[styles.content, compact && styles.compact]}>
      <View style={styles.instrument}>
        <Pressable
          accessibilityLabel="Back to markets"
          accessibilityRole="button"
          hitSlop={14}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Text style={styles.backLabel}>‹</Text>
        </Pressable>
        <MarketLogo size={30} symbol={market.baseAsset} url={market.iconUrl} />
        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.symbol}>{market.baseAsset}-USD</Text>
          <Text numberOfLines={1} style={styles.subtitle}>Velocity · USDT margin</Text>
        </View>
        <View style={styles.priceBlock}>
          {snapshot === null ? (
            <SkeletonText align="right" role="heading" width={86} />
          ) : (
            <Text numberOfLines={1} selectable style={styles.price}>
              ${formatAmountWithCommas(snapshot.price)}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.figures}>
        <Figure
          label="24H VOL"
          value={snapshot === null ? UNAVAILABLE : formatCompactUsd(snapshot.volume24h)}
        />
        <Figure
          label="OPEN INTEREST"
          value={snapshot === null ? UNAVAILABLE : formatCompactUsd(snapshot.openInterest)}
        />
        <Figure label="MAX LEVERAGE" value={`${market.maxLeverage}×`} />
        <Figure label="COLLATERAL" value="USDT" />
      </View>

      <VelocityOrderTicket config={config.value} market={market} />
    </AppScreen>
  );
}

function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.figure}>
      <Text numberOfLines={1} style={styles.figureLabel}>{label}</Text>
      <Text numberOfLines={1} selectable style={styles.figureValue}>{value}</Text>
    </View>
  );
}

function Loading({ compact }: { readonly compact: boolean }) {
  return (
    <AppScreen contentContainerStyle={[styles.content, compact && styles.compact]}>
      <View accessibilityRole="progressbar" style={styles.instrument}>
        <Skeleton height={30} radius={15} width={30} />
        <SkeletonText role="heading" width={120} />
        <View style={styles.priceBlock}>
          <SkeletonText align="right" role="heading" width={86} />
        </View>
      </View>
      <Skeleton height={100} radius={radii.sm} />
      <Skeleton height={340} radius={radii.sm} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPaddingCompact,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  compact: { paddingHorizontal: spacing.xs },
  centered: { flexGrow: 1, justifyContent: 'center' },
  instrument: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  back: { width: 26, minHeight: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  backLabel: { ...typography.title, color: colors.textPrimary, lineHeight: 34 },
  identity: { flex: 1, minWidth: 0 },
  symbol: { ...typography.heading, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textMuted },
  priceBlock: { marginLeft: 'auto', alignItems: 'flex-end' },
  price: { ...typography.label, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  figures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  figure: { minWidth: '42%', gap: spacing.xxs },
  figureLabel: { ...typography.eyebrow, color: colors.textMuted },
  figureValue: { ...typography.bodyCompact, color: colors.textPrimary },
  pressed: { opacity: 0.72 },
});
