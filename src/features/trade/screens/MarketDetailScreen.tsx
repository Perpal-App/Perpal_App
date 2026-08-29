import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { SkeletonText } from '@/components/feedback/Skeleton';
import { AppScreen } from '@/components/layout/AppScreen';
import { RiseInView } from '@/components/motion/RiseInView';
import { readAppConfig } from '@/config/appConfig';
import {
  formatAmountWithCommas,
  formatCompactTokenPrice,
  formatCompactUsd,
} from '@/domain/money/amount';
import { MarketLogo } from '@/features/trade/components/MarketLogo';
import { PacificaTradingWorkspace } from '@/features/trade/components/PacificaTradingWorkspace';
import { usePacificaMarkets } from '@/features/trade/hooks/usePacificaMarkets';
import { VelocityMarketDetailScreen } from '@/features/trade/screens/VelocityMarketDetailScreen';
import { formatPacificaRatePercent } from '@/integrations/perps/pacifica/pacificaMarketData';
import { colors, fonts, layout, motion, radii, spacing, typography } from '@/theme/tokens';

/** Placeholder shape shared with the markets table and the order ticket. */
const UNAVAILABLE = '--.--';

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
    provider?: string | string[];
    venueRef?: string | string[];
  }>();
  const venueRef = Array.isArray(params.venueRef) ? params.venueRef[0] : params.venueRef;
  const provider = Array.isArray(params.provider) ? params.provider[0] : params.provider;
  if (provider === 'velocity') {
    return <VelocityMarketDetailScreen venueRef={venueRef ?? ''} />;
  }
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
  const price = snapshot !== null && !snapshot.priceStale ? snapshot.price : null;
  const change = snapshot?.change24hBps ?? null;
  const openInterest = snapshot?.openInterest ?? null;
  // No snapshot yet means the request is still out, which is what shimmers. A
  // snapshot that omits a value shows the placeholder instead.
  const pending = snapshot === null;
  const pricePending = snapshot === null || snapshot.priceStale;

  return (
    <AppScreen contentContainerStyle={[styles.content, compact && styles.compactGutter]}>
      {/* Instrument, figures and the section below rise in one cascade, the same
          reveal the onboarding and sign-in screens use. Each layer already sits in
          its final slot, so the travel is composited and nothing reflows. */}
      <RiseInView style={styles.instrument}>
        <BackButton />
        <MarketLogo size={30} symbol={market.baseAsset} url={market.iconUrl} />
        <View style={styles.identity}>
          {/* The pair owns the first line on its own. With the badge beside it an
              eight-character ticker ran past the price on anything under 390pt,
              and truncating the instrument is the one thing this header must not
              do — so leverage and contract type share the qualifier line below,
              the same split the markets table uses. */}
          <Text numberOfLines={1} style={styles.symbol}>
            {market.baseAsset}-USD
          </Text>
          <View style={styles.qualifier}>
            <View style={styles.leverageBadge}>
              <Text style={styles.leverage}>{market.maxLeverage}×</Text>
            </View>
            <Text numberOfLines={1} style={styles.name}>
              {market.displayName === market.baseAsset
                ? 'Perpetual'
                : `Perpetual · ${market.displayName}`}
            </Text>
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
              <Text numberOfLines={1} style={[styles.change, toneStyle(change)]}>
                {formatChange(change)}
              </Text>
            </>
          )}
        </View>
      </RiseInView>

      <RiseInView delay={motion.rise.stagger} style={styles.figureGrid}>
        <Figure
          label="24H VOL"
          pending={pending}
          pendingWidth={56}
          value={snapshot?.volume24h == null ? UNAVAILABLE : formatCompactUsd(snapshot.volume24h)}
        />
        <Figure
          label="OI"
          pending={pending}
          pendingWidth={48}
          value={openInterest === null ? UNAVAILABLE : formatCompactUsd(openInterest)}
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
          value={snapshot === null ? UNAVAILABLE : formatPacificaRatePercent(snapshot.fundingRate)}
        />
        {/* "NEXT" rather than "NEXT RATE": the longer label was wider than any
            value in the row, so it — not the data — decided the column's width.
            The Market info tab spells both funding figures out in full. */}
        <Figure
          label="NEXT"
          pending={pending}
          pendingWidth={55}
          value={snapshot === null ? UNAVAILABLE : formatPacificaRatePercent(snapshot.nextFundingRate)}
        />
      </RiseInView>

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

function Figure({
  label,
  pending = false,
  pendingWidth,
  value,
}: {
  readonly label: string;
  readonly pending?: boolean;
  /** Width of the placeholder, set near the value's own so the row holds its shape. */
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

function formatChange(value: number | null): string {
  if (value === null) return UNAVAILABLE;
  const absolute = Math.abs(value);
  return `${value >= 0 ? '+' : '-'}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}%`;
}

function toneStyle(value: number | null) {
  if (value === null) return styles.absent;
  return value < 0 ? styles.negative : styles.positive;
}

/**
 * Shared by the real header and the loading one, so the chevron occupies the same slot
 * in both and the row does not shift sideways when the instrument arrives. It also has
 * to work while the catalog is still out: leaving is the one action that must never
 * depend on data.
 */
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

/** Placeholder widths for the figure row, near each real value's own width. */
const FIGURE_WIDTHS = [56, 48, 64, 55, 55] as const;
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
      <View
        accessibilityLabel="Loading market"
        accessibilityRole="progressbar"
        style={styles.instrument}
      >
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
        {FIGURE_WIDTHS.map((width, index) => (
          <View key={width * 100 + index} style={styles.figure}>
            <SkeletonText role="eyebrow" width={width * 0.7} />
            <SkeletonText role="caption" width={width} />
          </View>
        ))}
      </View>

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
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  // Below 360pt the panels need the margin more than the page does.
  compactGutter: { paddingHorizontal: spacing.xs },
  centered: { flexGrow: 1, justifyContent: 'center' },
  blocked: { ...typography.bodyCompact, color: colors.textSecondary },
  instrument: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // Narrow by design: the chevron only needs this much ink, and `hitSlop` on the
  // pressable keeps the touch target at full size without spending header width.
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
  qualifier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    minWidth: 0,
  },
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
  // Label size, but on the symbol's line height: both blocks then measure the
  // same two lines, so the price sits exactly on the symbol's line and the change
  // on the line under it, without the price claiming the title's width.
  price: {
    ...typography.label,
    lineHeight: typography.heading.lineHeight,
    color: colors.textPrimary,
  },
  change: { ...typography.caption },
  // All five figures on one row. Each cell is only as wide as its own content and
  // the leftover space is shared between them, so the row reads as evenly spaced
  // without any cell being cut off — measured, the five come to 279pt against
  // 296pt of content width on the narrowest screen the app supports.
  //
  // `wrap` is the safety valve rather than the layout: at normal text size
  // everything fits one line, and if the reader scales type up the cells drop to
  // a second row instead of clipping.
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
  // Caption size so five figures clear one row, but on the semibold face: these
  // are numbers to scan, and the medium weight caption reads as body copy.
  figureValue: {
    ...typography.caption,
    fontFamily: fonts.semiBold,
    color: colors.textPrimary,
  },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  absent: { color: colors.textMuted },

  pressed: { opacity: 0.72 },
});
