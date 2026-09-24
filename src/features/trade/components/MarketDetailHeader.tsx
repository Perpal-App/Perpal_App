import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Skeleton, SkeletonText } from '@/components/feedback/Skeleton';
import { RiseInView } from '@/components/motion/RiseInView';
import { PressableScale } from '@/components/ui/PressableScale';
import {
  formatAmountWithCommas,
  formatCompactTokenPrice,
  formatCompactUsd,
} from '@/domain/money/amount';
import { MarketLogo } from '@/features/trade/components/MarketLogo';
import { formatPacificaRatePercent } from '@/integrations/perps/pacifica/pacificaMarketData';
import type {
  PacificaMarket,
  PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import {
  colors,
  fonts,
  gradients,
  layout,
  motion,
  radii,
  spacing,
  typography,
} from '@/theme/tokens';

/** Placeholder shape shared with the markets table and the order ticket. */
const UNAVAILABLE = '--.--';

/**
 * The back control's own size, and the chevron inside it.
 *
 * 36 so it sits beside the 30pt asset mark rather than over it, which leaves the identity block 198pt
 * on a 360pt screen against the 135pt the longest ticker in the catalog — `CRUDEOIL-USD` — needs. The
 * header has the room; what it did not have was a control.
 */
const BACK_SIZE = 36;
const BACK_GLYPH = 20;

/** Placeholder widths for the figure row, near each real value's own width. */
const FIGURE_WIDTHS = [56, 48, 64, 55, 55] as const;

/**
 * What the instrument is, what it costs, and the venue's headline figures.
 *
 * Split out of `MarketDetailScreen`, which had crossed the file-size ceiling. The seam is the fold: this
 * is everything above the trading workspace, and it is the part that has both a live form and a loading
 * one — keeping the two in one file is what makes them provably share a style sheet, which is why the
 * row does not shift when the catalog lands.
 */
export function MarketDetailHeader({
  market,
  snapshot,
}: {
  readonly market: PacificaMarket;
  readonly snapshot: PacificaMarketSnapshot | null;
}) {
  const price = snapshot !== null && !snapshot.priceStale ? snapshot.price : null;
  const change = snapshot?.change24hBps ?? null;
  const openInterest = snapshot?.openInterest ?? null;
  // No snapshot yet means the request is still out, which is what shimmers. A snapshot that omits a
  // value shows the placeholder instead.
  const pending = snapshot === null;
  const pricePending = snapshot === null || snapshot.priceStale;

  return (
    <>
      {/* Instrument, figures and the section below rise in one cascade, the same reveal the onboarding
          and sign-in screens use. Each layer already sits in its final slot, so the travel is
          composited and nothing reflows. */}
      <RiseInView style={styles.instrument}>
        <BackButton />
        <MarketLogo size={30} symbol={market.baseAsset} url={market.iconUrl} />
        <View style={styles.identity}>
          {/* The pair owns the first line on its own. With the badge beside it an eight-character
              ticker ran past the price on anything under 390pt, and truncating the instrument is the
              one thing this header must not do — so leverage and contract type share the qualifier
              line below, the same split the markets table uses. */}
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
              <SkeletonText align="right" role="caption" width={76} />
            </>
          ) : (
            <>
              <Text
                // Named for a screen reader too, which previously heard a bare number with no
                // indication of which of this screen's two prices it had landed on.
                accessibilityLabel={price === null
                  ? 'Mark price unavailable'
                  : `Mark price, ${formatAmountWithCommas(price)} dollars`}
                numberOfLines={1}
                selectable
                style={styles.price}
              >
                {price === null ? UNAVAILABLE : `$${formatAmountWithCommas(price)}`}
              </Text>
              {/* The basis this block is quoted on, which the header never stated. Two prices appear on
                  this screen — the venue's mark here, the index price in the strip — and only the
                  second was named, so the unnamed one looked like it ought to match it. A gap between
                  them is normal; closing it is what the funding rate two cells over is for.
                  On the change line rather than above the price because both blocks in this header are
                  two lines, which is what sits the price on the symbol's line. It is also free: the
                  label plus the change measures 84pt against the 88.8pt the widest price
                  (`$0.00001234`) already claims, so the column does not grow.
                  One label covers both numbers honestly — `change24hBps` is derived from the mark
                  against yesterday's mark, never from the oracle. */}
              <View style={styles.priceBasis}>
                <Text style={styles.basisLabel}>MARK</Text>
                <Text numberOfLines={1} style={[styles.change, toneStyle(change)]}>
                  {formatChange(change)}
                </Text>
              </View>
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
        {/* `pricePending`, not `pending` — the only figure here gated on staleness, because it is the
            only one that is a price. `priceStale` covers the whole snapshot, since the venue stamps
            mark, oracle, volume, open interest and funding with one timestamp, so when it trips this
            value is exactly as old as the headline. It rendered anyway before, which left a stale
            snapshot showing a minute-old oracle price beside a skeleton where the mark had been — the
            one case where the gap between the two could widen with nothing on screen saying so.
            The aggregates keep the looser gate deliberately: a 24-hour volume forty seconds old is
            still the answer, a price that old is not. */}
        <Figure
          label="ORACLE"
          pending={pricePending}
          pendingWidth={64}
          value={snapshot === null ? UNAVAILABLE : formatCompactTokenPrice(snapshot.oraclePrice)}
        />
        <Figure
          label="FUNDING"
          pending={pending}
          pendingWidth={55}
          value={snapshot === null ? UNAVAILABLE : formatPacificaRatePercent(snapshot.fundingRate)}
        />
        {/* "NEXT" rather than "NEXT RATE": the longer label was wider than any value in the row, so it
            — not the data — decided the column's width. The Market info tab spells both funding
            figures out in full. */}
        <Figure
          label="NEXT"
          pending={pending}
          pendingWidth={55}
          value={snapshot === null
            ? UNAVAILABLE
            : formatPacificaRatePercent(snapshot.nextFundingRate)}
        />
      </RiseInView>
    </>
  );
}

/**
 * The same two blocks before the venue has said which instrument this is.
 *
 * Built from the same style objects as the live header, so each value fills in exactly where its
 * placeholder was. That is why this replaced a centred spinner: a spinner sits in the middle of the
 * screen and then vanishes, moving every piece of content into place from nowhere.
 */
export function MarketDetailHeaderSkeleton() {
  return (
    <>
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
    </>
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
 * Leaving the screen, on the app's raised material.
 *
 * What was here was the character `‹` — U+2039, a single angle quotation mark — set in Poppins Bold at
 * the title size. That is a punctuation mark standing in for an icon, and it showed: the glyph's
 * advance at 26pt is 8.8pt, so the whole control was under nine points of hairline ink floating in a
 * 26pt box with no surface behind it. A quote mark's ink is also not centred in its advance the way an
 * icon's is, so it sat off-centre in that box as well.
 *
 * It is now the same object as every other icon control in the app: `gradients.surfaceRaise` under a
 * 1pt rim, a real glyph from the icon font, and `PressableScale`'s compression on press. Ionicons'
 * `chevron-back` inks symmetrically about its em centre, so it needs no optical nudge.
 *
 * Shared by the real header and the loading one, so the control occupies the same slot in both and the
 * row does not shift sideways when the instrument arrives. It also has to work while the catalog is
 * still out: leaving is the one action that must never depend on data.
 */
function BackButton() {
  const router = useRouter();

  return (
    <PressableScale
      accessibilityLabel="Back to markets"
      accessibilityRole="button"
      // Derived, not chosen: the visible button is 36pt and the target it answers to is
      // `layout.minTouchTarget`, so the slop is exactly the difference. It sits outside layout, which
      // is what lets the header spend 36pt while the finger gets all 48.
      hitSlop={(layout.minTouchTarget - BACK_SIZE) / 2}
      onPress={() => router.back()}
      pressedScale={0.94}
      style={styles.back}
    >
      <LinearGradient
        colors={gradients.surfaceRaise.colors}
        end={{ x: 0.5, y: 1 }}
        locations={gradients.surfaceRaise.locations}
        start={{ x: 0.5, y: 0 }}
        style={styles.backFill}
      >
        <Ionicons color={colors.textPrimary} name="chevron-back" size={BACK_GLYPH} />
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  instrument: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  // Clipped so the ramp takes the corners, and rimmed at a full point rather than a hairline — that is
  // what makes the edge read as the side of a raised surface instead of an outline drawn around a flat
  // one, and it is the same construction as the activity filter button and the search fields.
  //
  // `radii.sm` rather than a circle: the asset mark immediately beside it is a 30pt disc, and two
  // circles side by side read as a pair of tokens rather than as a control next to the thing it
  // describes. A rounded square keeps them different kinds of object.
  back: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: radii.sm,
    borderCurve: 'continuous',
    borderColor: colors.border,
  },
  backFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  // Label size, but on the symbol's line height: both blocks then measure the same two lines, so the
  // price sits exactly on the symbol's line and the change on the line under it, without the price
  // claiming the title's width.
  price: {
    ...typography.label,
    lineHeight: typography.heading.lineHeight,
    color: colors.textPrimary,
  },
  priceBasis: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  // The strip's own label treatment, so the word naming the headline's basis and the word naming the
  // oracle's are visibly the same kind of thing — which is the point, since the reader is being asked
  // to tell two prices apart.
  basisLabel: { ...typography.eyebrow, letterSpacing: 0.5, color: colors.textMuted },
  change: { ...typography.caption },
  // All five figures on one row. Each cell is only as wide as its own content and the leftover space is
  // shared between them, so the row reads as evenly spaced without any cell being cut off — measured,
  // the five come to 279pt against 296pt of content width on the narrowest screen the app supports.
  //
  // `wrap` is the safety valve rather than the layout: at normal text size everything fits one line,
  // and if the reader scales type up the cells drop to a second row instead of clipping.
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
  // Caption size so five figures clear one row, but on the semibold face: these are numbers to scan,
  // and the medium weight caption reads as body copy.
  figureValue: {
    ...typography.caption,
    fontFamily: fonts.semiBold,
    color: colors.textPrimary,
  },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  absent: { color: colors.textMuted },
});
