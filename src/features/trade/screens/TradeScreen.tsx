import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { readAppConfig } from '@/config/appConfig';
import {
  MarketTableHeader,
  MarketTableRow,
  type MarketTableEntry,
} from '@/features/trade/components/MarketTable';
import {
  usePacificaMarkets,
  type PacificaVenueState,
} from '@/features/trade/hooks/usePacificaMarkets';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

export function TradeScreen() {
  const router = useRouter();
  const config = readAppConfig();
  const compact = useWindowDimensions().width < layout.compactWidth;
  const venue = usePacificaMarkets(
    config.ok ? config.value.perps.pacificaApiOrigin : '',
    config.ok ? config.value.perps.pacificaWsOrigin : '',
  );
  const snapshots = useMemo(
    () => new Map(venue.snapshots.map((snapshot) => [snapshot.venueRef, snapshot])),
    [venue.snapshots],
  );
  const entries = useMemo<readonly MarketTableEntry[]>(
    () => venue.markets
      .map((market) => ({ market, venue: snapshots.get(market.venueRef) ?? null }))
      .sort((left, right) => {
        const leftVolume = left.venue?.volume24h.baseUnits ?? -1n;
        const rightVolume = right.venue?.volume24h.baseUnits ?? -1n;
        return leftVolume === rightVolume ? 0 : leftVolume > rightVolume ? -1 : 1;
      }),
    [snapshots, venue.markets],
  );

  return (
    <AppScreen scroll={false}>
      <FlatList
        bounces={false}
        contentContainerStyle={styles.container}
        data={entries}
        initialNumToRender={14}
        keyExtractor={(entry) => entry.market.venueRef}
        ListHeaderComponent={(
          <View>
            <View style={[styles.header, compact && styles.compactGutter]}>
              <View>
                <Text accessibilityRole="header" style={styles.title}>Markets</Text>
                <Text style={styles.subtitle}>Pacifica perpetuals · public market data</Text>
              </View>
              <FeedStatus status={venue.status} />
            </View>
            {venue.status === 'error' ? (
              <Text accessibilityRole="alert" style={styles.notice}>
                Pacifica market data is reconnecting. Trading stays blocked until prices are current.
              </Text>
            ) : null}
            <MarketTableHeader compact={compact} />
          </View>
        )}
        ListEmptyComponent={venue.status === 'loading' ? (
          <Text accessibilityLiveRegion="polite" style={styles.empty}>Loading Pacifica markets…</Text>
        ) : null}
        maxToRenderPerBatch={14}
        removeClippedSubviews
        renderItem={({ item }) => (
          <MarketTableRow
            compact={compact}
            entry={item}
            onPress={() => router.push({
              pathname: '/(tabs)/trade/[venueRef]',
              params: { venueRef: item.market.venueRef },
            })}
          />
        )}
        showsVerticalScrollIndicator={false}
        windowSize={5}
      />
    </AppScreen>
  );
}

function FeedStatus({ status }: { readonly status: PacificaVenueState }) {
  const label = status === 'ready'
    ? 'Live'
    : status === 'error'
      ? 'Reconnecting'
      : status === 'loading'
        ? 'Connecting'
        : 'Offline';
  return (
    <View accessible accessibilityLabel={`Pacifica market data: ${label}`} style={styles.feedStatus}>
      <View style={[
        styles.feedDot,
        status === 'ready'
          ? styles.feedDotLive
          : status === 'error'
            ? styles.feedDotError
            : styles.feedDotIdle,
      ]} />
      <Text style={styles.feedLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  compactGutter: { paddingHorizontal: layout.screenPaddingCompact },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
  },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textMuted },
  feedStatus: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  feedDot: { width: 6, height: 6, borderRadius: radii.pill },
  feedDotLive: { backgroundColor: colors.positive },
  feedDotError: { backgroundColor: colors.negative },
  feedDotIdle: { backgroundColor: colors.textMuted },
  feedLabel: { ...typography.caption, color: colors.textMuted },
  notice: {
    ...typography.caption,
    paddingVertical: spacing.xs,
    paddingHorizontal: layout.screenPadding,
    backgroundColor: colors.surface,
    color: colors.textSecondary,
  },
  empty: { ...typography.bodyCompact, padding: layout.screenPadding, color: colors.textSecondary },
});
