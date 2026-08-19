import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';

import { AppScreen } from '@/components/layout/AppScreen';
import {
  AnchoredMenu,
  anchorBelow,
  type MenuAnchor,
  type MenuOption,
} from '@/components/ui/AnchoredMenu';
import { ChevronDown } from '@/components/ui/ChevronDown';
import { PressableScale } from '@/components/ui/PressableScale';
import { SearchField } from '@/components/ui/SearchField';
import { readAppConfig, type PerpsProviderId } from '@/config/appConfig';
import {
  MarketTableHeader,
  MarketTableRow,
  MarketTableSkeletonRow,
  type MarketTableEntry,
} from '@/features/trade/components/MarketTable';
import {
  usePacificaMarkets,
} from '@/features/trade/hooks/usePacificaMarkets';
import { useVelocityMarkets } from '@/features/trade/hooks/useVelocityMarkets';
import { formatPacificaRatePercent } from '@/integrations/perps/pacifica/pacificaMarketData';
import { TAB_BAR_CLEARANCE } from '@/navigation/tabs/GlassTabBar';
import { useMinimizeOnScroll } from '@/navigation/tabs/minimizeState';
import { colors, layout, spacing, typography } from '@/theme/tokens';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';

const PROVIDERS: readonly MenuOption<PerpsProviderId>[] = [
  { id: 'pacifica', label: 'Pacifica' },
  { id: 'velocity', label: 'Velocity' },
];

export function TradeScreen() {
  const router = useRouter();
  const config = readAppConfig();
  const { perpsProvider, setPerpsProvider } = useAppPreferences();
  const [query, setQuery] = useState('');
  const onScroll = useMinimizeOnScroll();
  const compact = useWindowDimensions().width < layout.compactWidth;
  const pacifica = usePacificaMarkets(
    config.ok ? config.value.perps.pacificaApiOrigin : '',
    config.ok ? config.value.perps.pacificaAssetOrigin : '',
    config.ok ? config.value.perps.pacificaWsOrigin : '',
    perpsProvider === 'pacifica',
  );
  const velocity = useVelocityMarkets(
    config.ok ? config.value.api.publicRpcUrl : '',
    config.ok ? config.value.perps.velocityProgramId : '',
    config.ok ? config.value.perps.pacificaAssetOrigin : '',
    perpsProvider === 'velocity',
  );
  const entries = useMemo<readonly MarketTableEntry[]>(
    () => {
      const rows = perpsProvider === 'pacifica'
        ? joinMarkets(
            pacifica.markets,
            pacifica.snapshots,
            query,
            (snapshot) => `Next ${formatPacificaRatePercent(snapshot.nextFundingRate)}`,
          )
        : joinMarkets(
            velocity.markets,
            velocity.snapshots,
            query,
            () => 'USDT collateral',
          );
      return rows.sort((left, right) => {
        const leftVolume = left.venue?.volume24h?.baseUnits ?? -1n;
        const rightVolume = right.venue?.volume24h?.baseUnits ?? -1n;
        return leftVolume === rightVolume ? 0 : leftVolume > rightVolume ? -1 : 1;
      });
    },
    [pacifica.markets, pacifica.snapshots, perpsProvider, query, velocity.markets, velocity.snapshots],
  );
  const venueStatus = perpsProvider === 'pacifica' ? pacifica.status : velocity.status;

  // Both stable, which is what lets `MarketTableRow`'s memo hold: a `renderItem` or an
  // `onPress` rebuilt inline would hand every row a new prop on every price message and
  // re-render the whole visible list for one market's tick.
  const openMarket = useCallback(
    (venueRef: string) => router.push({
      pathname: '/(tabs)/trade/[venueRef]',
      params: { provider: perpsProvider, venueRef },
    }),
    [perpsProvider, router],
  );
  const renderRow = useCallback(
    ({ item }: { readonly item: MarketTableEntry }) => (
      <MarketTableRow compact={compact} entry={item} onSelect={openMarket} />
    ),
    [compact, openMarket],
  );

  return (
    <AppScreen scroll={false}>
      <Animated.FlatList
        bounces={false}
        contentContainerStyle={styles.container}
        data={entries}
        initialNumToRender={14}
        keyExtractor={(entry) => entry.market.venueRef}
        ListHeaderComponent={(
          // Nothing structural in here is gated behind an entrance animation. The
          // column header was wrapped in one and rendered invisible on device:
          // between a virtualized list header and an animated transform there are
          // too many ways for a layer to be clipped, and a column title is not
          // worth that risk. The rows' shimmer-to-value transition carries the
          // motion on this screen.
          <View>
            <View style={[styles.header, compact && styles.compactGutter]}>
              <Text accessibilityRole="header" style={styles.title}>Markets</Text>
              <ProviderSelector
                onSelect={setPerpsProvider}
                selected={perpsProvider}
              />
            </View>
            <SearchField
              compact={compact}
              onChangeText={setQuery}
              placeholder="Search markets"
              value={query}
            />
            {venueStatus === 'error' ? (
              <Text accessibilityRole="alert" style={styles.notice}>
                {perpsProvider === 'pacifica' ? 'Pacifica' : 'Velocity'} market data is reconnecting. Trading stays blocked until prices are current.
              </Text>
            ) : null}
            <MarketTableHeader compact={compact} />
          </View>
        )}
        ListEmptyComponent={(
          <MarketListPlaceholder
            compact={compact}
            query={query}
            status={venueStatus}
            provider={perpsProvider}
          />
        )}
        keyboardShouldPersistTaps="handled"
        maxToRenderPerBatch={14}
        renderItem={renderRow}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        // Three viewports of rows kept mounted rather than five. The catalog runs to a
        // hundred and fifty markets, so the further this was scrolled the more rows were
        // realized and re-rendered on every price batch. Remounting a row is cheap now
        // that its logo is decoded once and cached, so holding fewer of them is the
        // better trade.
        windowSize={3}
      />
    </AppScreen>
  );
}

function ProviderSelector({
  onSelect,
  selected,
}: {
  readonly onSelect: (provider: PerpsProviderId) => void;
  readonly selected: PerpsProviderId;
}) {
  const anchorRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [open, setOpen] = useState(false);
  const label = selected === 'pacifica' ? 'Pacifica' : 'Velocity';

  const openMenu = () => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor(anchorBelow(x, y, width, height, width));
      setOpen(true);
    });
  };

  return (
    <>
      <View ref={anchorRef}>
        <PressableScale
          accessibilityHint="Selects the perpetuals provider"
          accessibilityLabel={`Trading provider, ${label}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={openMenu}
          pressedScale={0.97}
          style={styles.providerTrigger}
        >
          <Text numberOfLines={1} style={styles.providerLabel}>{label}</Text>
          <ChevronDown color={colors.textSecondary} />
        </PressableScale>
      </View>
      <AnchoredMenu
        anchor={anchor}
        onClose={() => setOpen(false)}
        onSelect={(provider) => {
          onSelect(provider);
          setOpen(false);
        }}
        options={PROVIDERS}
        selected={selected}
        title="Provider"
        visible={open}
      />
    </>
  );
}

/**
 * Matches a market on its ticker or its full name, so "sol", "SOL" and "solana"
 * all find the same row. Blank query matches everything.
 */
function matches(market: MarketTableEntry['market'], query: string): boolean {
  const needle = query.trim().toLowerCase();

  if (needle.length === 0) return true;

  return market.baseAsset.toLowerCase().includes(needle) ||
    market.displayName.toLowerCase().includes(needle);
}

function joinMarkets<
  Market extends MarketTableEntry['market'],
  Snapshot extends NonNullable<MarketTableEntry['venue']> & { readonly venueRef: string },
>(
  markets: readonly Market[],
  snapshots: readonly Snapshot[],
  query: string,
  detail: (snapshot: Snapshot) => string,
): MarketTableEntry[] {
  const byMarket = new Map(snapshots.map((snapshot) => [snapshot.venueRef, snapshot]));
  return markets.filter((market) => matches(market, query)).map((market) => {
    const snapshot = byMarket.get(market.venueRef) ?? null;
    return { market, venue: snapshot, detailText: snapshot === null ? '' : detail(snapshot) };
  });
}

/** Rows to shimmer before the venue's first answer — roughly a phone's worth. */
const PLACEHOLDER_ROWS = 9;

/**
 * What stands in for the table when it has no rows.
 *
 * A wait is shown as the table itself, shimmering, rather than as a line of status
 * text: the shape of what is coming is more informative than a word about it, and
 * it means the screen never swaps one kind of content for another. Text is reserved
 * for the two cases where no rows is the answer — a search with no match, and a
 * venue that returned nothing.
 */
function MarketListPlaceholder({
  compact,
  query,
  status,
  provider,
}: {
  readonly compact: boolean;
  readonly query: string;
  readonly provider: 'pacifica' | 'velocity';
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
}) {
  const searching = query.trim().length > 0;

  if (searching) {
    return (
      <Text accessibilityLiveRegion="polite" style={styles.empty}>
        {`No market matches “${query.trim()}”.`}
      </Text>
    );
  }

  if (status === 'ready') {
    return (
      <Text accessibilityLiveRegion="polite" style={styles.empty}>
        {`No markets reported by ${provider === 'pacifica' ? 'Pacifica' : 'Velocity'}.`}
      </Text>
    );
  }

  return (
    <View accessibilityLabel="Loading markets" accessibilityRole="progressbar">
      {Array.from({ length: PLACEHOLDER_ROWS }, (_unused, index) => (
        <MarketTableSkeletonRow compact={compact} key={index} />
      ))}
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
    // The floating tab bar draws over the list, so the last row buys its own room.
    paddingBottom: TAB_BAR_CLEARANCE,
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

  providerTrigger: {
    minWidth: 144,
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
  providerLabel: { ...typography.label, color: colors.textPrimary },


  notice: {
    ...typography.caption,
    paddingVertical: spacing.xs,
    paddingHorizontal: layout.screenPadding,
    backgroundColor: colors.surface,
    color: colors.textSecondary,
  },
  empty: { ...typography.bodyCompact, padding: layout.screenPadding, color: colors.textSecondary },
});
