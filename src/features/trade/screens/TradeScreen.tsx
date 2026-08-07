import { useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { readAppConfig } from '@/config/appConfig';
import {
  MarketCategoryTabs,
  type MarketCategoryOption,
} from '@/features/trade/components/MarketCategoryTabs';
import {
  MarketTableHeader,
  MarketTableRow,
  type MarketTableEntry,
} from '@/features/trade/components/MarketTable';
import {
  useFlashVenueMarkets,
  type FlashVenueState,
} from '@/features/trade/hooks/useFlashVenueMarkets';
import {
  listMainnetMarkets,
  type MainnetMarketCategory,
} from '@/integrations/perps/markets/mainnetCatalog';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

/**
 * Markets list: a read-only table of Flash perpetuals ranked by 24h volume. It
 * reports price, 24h move, volume and open interest and stops there — order entry
 * belongs to a market's own screen, not to a row in a scanning list.
 *
 * The layout is deliberately flat: a title block, a filter strip seated on the
 * table's own header band, and rows — each sized by flex rather than by measured
 * pixels. The market catalog is known synchronously, so every row is on screen
 * from the first frame with `--.--` in place of values it does not have yet.
 * Nothing is swapped in or out as the feed connects, so the screen does not
 * reflow on launch on any device.
 */
export function TradeScreen() {
  const config = readAppConfig();
  // Width only, and only to pick a gutter: the table needs the extra 16pt on the
  // narrowest phones for its widest symbol and price to stay inside their
  // columns. Nothing here reads screen height or measures a layout.
  const compact = useWindowDimensions().width < layout.compactWidth;
  const markets = useMemo(() => listMainnetMarkets(), []);
  const categories = useMemo(() => marketCategories(markets), [markets]);
  const [selectedCategory, setSelectedCategory] = useState<MarketFilter>('all');
  const flashProgramId = config.ok ? config.value.perps.flashProgramId : '';
  const flashErRpc = config.ok ? config.value.perps.flashErRpc : '';
  const flashDataOrigin = config.ok ? config.value.perps.flashDataOrigin : '';
  const flashStatsOrigin = config.ok ? config.value.perps.flashStatsOrigin : '';
  const flashMarkets = useFlashVenueMarkets(
    flashErRpc,
    flashProgramId,
    flashDataOrigin,
    flashStatsOrigin,
    markets,
  );
  const snapshots = useMemo(
    () => new Map(flashMarkets.snapshots.map((market) => [market.venueRef, market])),
    [flashMarkets.snapshots],
  );
  const entries = useMemo<readonly MarketTableEntry[]>(() => {
    const filtered = selectedCategory === 'all'
      ? markets
      : markets.filter((market) => market.category === selectedCategory);

    return filtered
      .map((market) => ({ market, venue: snapshots.get(market.venueRef) ?? null }))
      .sort((left, right) => {
        // Markets with no reported volume sort last rather than mixing into the
        // ranking with an assumed zero. Before the first snapshot every market
        // is unreported, so the list opens in catalog order.
        const leftVolume = left.venue?.volume24h?.baseUnits ?? -1n;
        const rightVolume = right.venue?.volume24h?.baseUnits ?? -1n;
        return leftVolume === rightVolume ? 0 : leftVolume > rightVolume ? -1 : 1;
      });
  }, [markets, selectedCategory, snapshots]);

  return (
    // The list is its own scroller, so AppScreen keeps the safe area and steps
    // out of the way rather than wrapping a FlatList in a ScrollView.
    <AppScreen scroll={false}>
      <FlatList
        bounces={false}
        contentContainerStyle={styles.container}
        contentInsetAdjustmentBehavior="never"
        data={entries}
        initialNumToRender={12}
        keyExtractor={(entry) => entry.market.venueRef}
        ListHeaderComponent={(
          <View>
            <View style={[styles.header, compact && styles.compactGutter]}>
              <Text accessibilityRole="header" style={styles.title}>Markets</Text>
              <FeedStatus status={flashMarkets.status} />
            </View>

            {/* Beside the status it reports on, and above the filter strip, so
                the strip stays seated on the table it belongs to. */}
            {flashMarkets.status === 'error' ? (
              <Text
                accessibilityRole="alert"
                style={[styles.notice, compact && styles.compactGutter]}
              >
                The public Flash endpoint is unavailable. Reconnecting automatically.
              </Text>
            ) : null}

            <MarketCategoryTabs
              compact={compact}
              onSelect={(id) => setSelectedCategory(id as MarketFilter)}
              options={categories}
              selectedId={selectedCategory}
            />

            <MarketTableHeader compact={compact} />
          </View>
        )}
        maxToRenderPerBatch={12}
        removeClippedSubviews
        renderItem={({ item }) => <MarketTableRow compact={compact} entry={item} />}
        showsVerticalScrollIndicator={false}
        windowSize={5}
      />
    </AppScreen>
  );
}

/**
 * Feed state for the whole table. The label is always rendered, so the state is
 * never carried by the dot's colour alone and the header never changes height.
 */
function FeedStatus({ status }: { readonly status: FlashVenueState }) {
  const label = feedLabel(status);

  return (
    <View
      accessible
      accessibilityLabel={`Flash market data: ${label}`}
      accessibilityLiveRegion="polite"
      style={styles.feedStatus}
    >
      <View style={[styles.feedDot, feedDotStyle(status)]} />
      <Text style={styles.feedLabel}>{label}</Text>
    </View>
  );
}

type MarketFilter = 'all' | MainnetMarketCategory;

const CATEGORY_ORDER: readonly MainnetMarketCategory[] = [
  'crypto',
  'forex',
  'commodities',
  'metals',
  'equities',
  'other',
];

function marketCategories(
  markets: ReturnType<typeof listMainnetMarkets>,
): readonly MarketCategoryOption[] {
  const present = CATEGORY_ORDER.flatMap((category) =>
    markets.some((market) => market.category === category)
      ? [{ id: category, label: categoryLabel(category) }]
      : [],
  );

  return [{ id: 'all', label: 'All' }, ...present];
}

function categoryLabel(category: MainnetMarketCategory): string {
  return `${category[0]?.toUpperCase() ?? ''}${category.slice(1)}`;
}

function feedLabel(status: FlashVenueState): string {
  if (status === 'ready') return 'Live';
  if (status === 'error') return 'Reconnecting';
  if (status === 'loading') return 'Connecting';
  return 'Offline';
}

function feedDotStyle(status: FlashVenueState) {
  if (status === 'ready') return styles.feedDotLive;
  return status === 'error' ? styles.feedDotError : styles.feedDotIdle;
}

const styles = StyleSheet.create({
  // No horizontal padding here: the gutter belongs to each block inside the list
  // so that the table's band and rules can reach both screen edges while their
  // contents stay in one column. Only the width cap and the vertical rhythm are
  // the container's business.
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
    // The filter strip below carries its own padding and must stay flush with
    // the table header, so the title block owns the space between them.
    marginBottom: spacing.xs,
  },
  title: { ...typography.title, flexShrink: 1, color: colors.textPrimary },
  feedStatus: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  feedDot: { width: 6, height: 6, borderRadius: radii.pill },
  feedDotLive: { backgroundColor: colors.positive },
  feedDotError: { backgroundColor: colors.negative },
  feedDotIdle: { backgroundColor: colors.textMuted },
  feedLabel: { ...typography.caption, color: colors.textMuted },
  // A full-width band rather than an inset pill, matching the table's header:
  // one shared edge treatment for every strip of surface on this screen.
  notice: {
    ...typography.caption,
    marginBottom: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: layout.screenPadding,
    backgroundColor: colors.surface,
    color: colors.textSecondary,
  },
});
