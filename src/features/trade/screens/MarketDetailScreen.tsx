import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { AppScreen } from '@/components/layout/AppScreen';
import { RiseInView } from '@/components/motion/RiseInView';
import { readAppConfig } from '@/config/appConfig';
import {
  MarketDetailHeader,
  MarketDetailHeaderSkeleton,
} from '@/features/trade/components/MarketDetailHeader';
import {
  ORDER_BAR_CLEARANCE,
  OrderActionBar,
} from '@/features/trade/components/OrderActionBar';
import { PacificaTradingWorkspace } from '@/features/trade/components/PacificaTradingWorkspace';
import { usePacificaMarkets } from '@/features/trade/hooks/usePacificaMarkets';
import { colors, layout, motion, radii, spacing, typography } from '@/theme/tokens';

/**
 * One perpetual, in the order a trader reads it: what it is and what it costs,
 * the venue's headline figures, then the trading or chart workspace.
 *
 * The instrument header and the figure strip stay put while the section below
 * swaps, so moving between order entry and analysis never moves the price being
 * watched. Every order still ends at the explicit review-and-sign boundary.
 */
export function MarketDetailScreen() {
  const params = useLocalSearchParams<{
    venueRef?: string | string[];
  }>();
  const venueRef = Array.isArray(params.venueRef) ? params.venueRef[0] : params.venueRef;
  return <PacificaMarketDetailScreen venueRef={venueRef ?? ''} />;
}

function PacificaMarketDetailScreen({ venueRef }: { readonly venueRef: string }) {
  const compact = useWindowDimensions().width < layout.compactWidth;
  const router = useRouter();
  const config = readAppConfig();
  const perps = config.ok ? config.value.perps : null;
  const venue = usePacificaMarkets(
    perps?.pacificaApiOrigin ?? '',
    perps?.pacificaAssetOrigin ?? '',
    perps?.pacificaWsOrigin ?? '',
  );
  const market = useMemo(
    () => venue.markets.find((candidate) => candidate.venueRef === venueRef),
    [venue.markets, venueRef],
  );
  const expandChart = useCallback(() => {
    if (market === undefined) return;
    router.push({
      pathname: '/market-chart/[venueRef]',
      params: { venueRef: market.venueRef },
    });
  }, [market, router]);
  // An empty catalog is not a missing market. Until the venue has answered we do
  // not know whether this instrument exists, so the screen waits instead of
  // claiming it is unavailable — that claim flashing up on every tap was the whole
  // bug. Only a catalog that arrived and does not contain the market is an error.
  if (config.ok && market === undefined && venue.status !== 'ready') {
    return <MarketDetailSkeleton compact={compact} />;
  }

  if (market === undefined || !config.ok) {
    return (
      <AppScreen contentContainerStyle={styles.centered}>
        <EmptyState
          action={{ label: 'Back to markets', onPress: () => router.replace('/(tabs)/trade') }}
          message={config.ok
            ? 'This Pacifica market is not present in the current public catalog.'
            : 'Market configuration is missing from this build.'}
          title="Market not found"
        />
      </AppScreen>
    );
  }

  const snapshot = venue.snapshots.find((candidate) => candidate.venueRef === market.venueRef) ?? null;

  return (
    <AppScreen
      contentContainerStyle={[styles.content, compact && styles.compactGutter]}
      /* Floated over the page, not docked under it. The content runs beneath and shows through the
         bar's blur, which is why `content` reserves `ORDER_BAR_CLEARANCE` at the bottom — an overlay
         cannot reserve its own space. The tab bar already stands down for this:
         `app/(tabs)/_layout.tsx` hides the pill on a pushed screen because the capsule samples what is
         behind it and would bury these buttons and take on their colour. */
      overlay={<OrderActionBar market={market} snapshot={snapshot} />}
    >
      <MarketDetailHeader market={market} snapshot={snapshot} />

      <RiseInView delay={motion.rise.stagger * 2}>
        <PacificaTradingWorkspace
          config={config.value}
          market={market}
          onExpandChart={expandChart}
          snapshot={snapshot}
        />
      </RiseInView>
    </AppScreen>
  );
}

/** Matches `TradingViewMarketChart`'s workspace, so the fold lands in the same place. */
const CHART_SKELETON_HEIGHT = 420;

/**
 * The screen before the venue has told us which instrument this is.
 *
 * Built from the same style objects as the real screen, so the header and the figure row
 * fill in exactly where their placeholders were. That is the reason this replaced a
 * centred spinner: a spinner sits in the middle of the screen and then vanishes, moving
 * every piece of content into place from nowhere.
 *
 * The chart block reserves the workspace height rather than reproducing the section tabs
 * and timeframe strip, so the fold holds but those two rows do appear when the catalog
 * lands. Worth knowing, not worth another twenty lines of placeholder chrome for a wait
 * measured in a few hundred milliseconds.
 */
function MarketDetailSkeleton({ compact }: { readonly compact: boolean }) {
  return (
    <AppScreen contentContainerStyle={[styles.content, compact && styles.compactGutter]}>
      <MarketDetailHeaderSkeleton />
      <Skeleton height={CHART_SKELETON_HEIGHT} radius={radii.sm} />
    </AppScreen>
  );
}



const styles = StyleSheet.create({
  // This screen runs a tighter gutter than the reading screens, and deliberately: below the
  // figure strip it is two panels of live numbers side by side, so every point spent on
  // margin is taken off a price column. `layout.screenPadding` left 48pt of empty page on a
  // phone and squeezed the order-type selector to 42pt of label — narrower than the word
  // "Market". The dense screens are exactly what `screenPaddingCompact` is for.
  content: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPaddingCompact,
    paddingTop: spacing.md,
    // The order buttons float over this, so the last panel buys its own room past them. Derived from
    // the bar rather than guessed, so changing its height moves this with it.
    paddingBottom: spacing.md + ORDER_BAR_CLEARANCE,
    gap: spacing.sm,
  },
  // Below 360pt the panels need the margin more than the page does.
  compactGutter: { paddingHorizontal: spacing.xs },
  centered: { flexGrow: 1, justifyContent: 'center' },
  blocked: { ...typography.bodyCompact, color: colors.textSecondary },
});
