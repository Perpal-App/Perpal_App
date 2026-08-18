import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';

import { Skeleton, SkeletonText } from '@/components/feedback/Skeleton';
import {
  formatCompactTokenPrice,
  formatCompactUsd,
  type Amount,
} from '@/domain/money/amount';
import {
  MARKET_LOGO_SIZE,
  MarketLogo,
} from '@/features/trade/components/MarketLogo';
import { colors, gradients, layout, radii, spacing, typography } from '@/theme/tokens';

/**
 * Printed wherever the venue has not published a usable value yet. Shaped like
 * the number it stands in for — the order ticket uses the same placeholder — so
 * a waiting cell keeps the column's rhythm instead of collapsing to a dash. It
 * always renders in the muted tone below, so an absent value never reads as data.
 */
const UNAVAILABLE = '--.--';

/**
 * Column proportions. Every row uses these, so the grid is identical on a 320pt
 * phone and a 430pt one and never moves as values arrive or tick. They are sized
 * from the widest strings the venue actually reports, measured in Poppins at the
 * sizes below:
 *
 *   market  — mark (26pt) + an 8-character symbol (`CRUDEOIL`) + a `200×`
 *             badge, the longest identity block in the catalog   ≈ 145pt
 *   price   — `$0.00001234`, an eight-decimal oracle price        ≈ 88pt
 *   volume  — `$417.8K`                                           ≈ 58pt
 *
 * Every column clears its worst case from 360pt of screen width up, with the
 * screen trading gutter for column room below that (see TradeScreen). Narrower
 * than 360pt the shares stay exact and the longest symbol gives up a character
 * to the ellipsis, because a clipped price would be the worse failure.
 */
const COLUMN_FLEX = { market: 1.85, price: 1.35, volume: 1.15 } as const;

/**
 * A three-column grid cannot grow sideways, so table text follows the reader's
 * text-size setting only up to this multiplier. Past it, prices would start
 * ellipsising, which is worse than slightly smaller type. Everything outside the
 * table — screen title, filters, status — scales without a cap.
 */
const MAX_TEXT_SCALE = 1.15;

export type MarketTableEntry = {
  readonly detailText: string;
  readonly market: {
    readonly baseAsset: string;
    readonly displayName: string;
    readonly iconUrl: string;
    readonly maxLeverage: number;
    readonly venueRef: string;
  };
  readonly venue: {
    readonly change24hBps: number | null;
    readonly openInterest: Amount | null;
    readonly price: Amount;
    readonly priceStale: boolean;
    readonly volume24h: Amount | null;
  } | null;
};

/**
 * Read-only perps table: one line per market, three columns, no per-row action.
 * Each column stacks a primary value over the one figure that qualifies it —
 * symbol over next funding, price over its 24h move, volume over open interest —
 * which is the densest honest form for scanning a venue on a phone.
 *
 * Rows render as soon as the market catalog is known and fill in as the venue
 * reports, so the table never changes height when data lands.
 */
export function MarketTableHeader({
  compact = false,
}: {
  readonly compact?: boolean;
}) {
  return (
    <View style={[styles.headerRow, compact && styles.compactStrip]}>
      {/* Same raised treatment as the search field: a shallow ramp from a lit top
          edge to a deeper base, rimmed on all four sides. */}
      <LinearGradient
        colors={gradients.surfaceRaise.colors}
        end={{ x: 0.5, y: 1 }}
        locations={gradients.surfaceRaise.locations}
        start={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.marketHeader}>
        <TableText style={styles.headerLabel}>MARKET</TableText>
      </View>
      <ColumnHeader label="PRICE / 24H" style={styles.priceColumn} />
      <ColumnHeader label="24H VOL / OI" style={styles.volumeColumn} />
    </View>
  );
}

function ColumnHeader({
  label,
  style,
}: {
  readonly label: string;
  readonly style: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      <TableText style={styles.headerLabelEnd}>{label}</TableText>
    </View>
  );
}

/**
 * A row's geometry with every cell shimmering, for the wait before the venue's
 * first answer. It matches the real row's paddings and type roles exactly, so the
 * table does not resize when actual rows replace it.
 */
export function MarketTableSkeletonRow({
  compact = false,
}: {
  readonly compact?: boolean;
}) {
  return (
    <View style={[styles.row, compact && styles.compactGutter]}>
      <View style={styles.marketColumn}>
        <Skeleton
          height={MARKET_LOGO_SIZE}
          radius={radii.pill}
          width={MARKET_LOGO_SIZE}
        />
        <View style={styles.identity}>
          <SkeletonText role="label" width={62} />
          <SkeletonText role="caption" width={84} />
        </View>
      </View>
      <View style={styles.priceColumn}>
        <SkeletonText align="right" role="label" width={70} />
        <SkeletonText align="right" role="caption" width={46} />
      </View>
      <View style={styles.volumeColumn}>
        <SkeletonText align="right" role="label" width={62} />
        <SkeletonText align="right" role="caption" width={40} />
      </View>
    </View>
  );
}

type MarketTableRowProps = {
  readonly entry: MarketTableEntry;
  readonly compact?: boolean;
  /**
   * Takes the venue reference rather than being a closure over this row, so the screen
   * can hand every row the same function. A per-row arrow would be a new prop on every
   * render and would defeat the memo below.
   */
  readonly onSelect: (venueRef: string) => void;
};

/**
 * One market row, memoized on the two things it actually draws from.
 *
 * The comparison looks through `entry` at `market` and `venue` because the screen rebuilds
 * that wrapper object for every row on every price message — comparing the wrapper would
 * never match. The market objects come from the catalog and the snapshots are preserved by
 * the feed's merge for anything that did not tick, so what re-renders on a message is the
 * handful of rows whose price actually moved rather than every row on screen.
 */
export const MarketTableRow = memo(
  MarketRow,
  (previous, next) => previous.compact === next.compact
    && previous.onSelect === next.onSelect
    && previous.entry.market === next.entry.market
    && previous.entry.venue === next.entry.venue
    && previous.entry.detailText === next.entry.detailText,
);

function MarketRow({ entry, compact = false, onSelect }: MarketTableRowProps) {
  const { market, venue } = entry;
  const price = venue !== null && !venue.priceStale ? venue.price : null;
  const change = price === null ? null : venue?.change24hBps ?? null;
  const volume = venue === null ? null : venue.volume24h;
  const openInterest = venue?.openInterest ?? null;

  const priceText = price === null ? UNAVAILABLE : formatCompactTokenPrice(price);
  const changeText = change === null ? UNAVAILABLE : formatChange(change);
  const volumeText = volume === null ? UNAVAILABLE : formatCompactUsd(volume);
  const openInterestText = openInterest === null
    ? UNAVAILABLE
    : formatCompactUsd(openInterest);
  // A row with no snapshot yet is still loading, so its cells shimmer. Once the
  // venue has answered, a value it does not publish shows the placeholder
  // instead: pending and unavailable are different states and read differently.
  const pending = venue === null;

  return (
    <Pressable
      accessible
      accessibilityLabel={[
        `${market.baseAsset} perpetual, ${market.displayName}`,
        `up to ${market.maxLeverage} times leverage`,
        `price ${spoken(priceText)}`,
        `24 hour change ${spoken(changeText)}`,
        `24 hour volume ${spoken(volumeText)}`,
        `open interest ${spoken(openInterestText)}`,
        entry.detailText,
      ].join('. ')}
      accessibilityHint="Opens market details and trade controls"
      accessibilityRole="button"
      onPress={() => onSelect(market.venueRef)}
      style={({ pressed }) => [
        styles.row,
        compact && styles.compactGutter,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.marketColumn}>
        <MarketLogo symbol={market.baseAsset} url={market.iconUrl} />
        <View style={styles.identity}>
          <View style={styles.tickerLine}>
            <TableText style={styles.symbol}>{market.baseAsset}</TableText>
            <View style={styles.leverageBadge}>
              <TableText style={styles.leverageText}>{`${market.maxLeverage}×`}</TableText>
            </View>
          </View>
          {pending ? (
            <SkeletonText role="caption" width={72} />
          ) : (
            <TableText style={styles.marketName}>{entry.detailText}</TableText>
          )}
        </View>
      </View>

      <View style={styles.priceColumn}>
        {pending ? (
          <>
            <SkeletonText align="right" role="label" width={70} />
            <SkeletonText align="right" role="caption" width={46} />
          </>
        ) : (
          <>
            <TableText style={[styles.primaryValue, price === null && styles.absent]}>
              {priceText}
            </TableText>
            <TableText style={[styles.secondaryValue, changeTone(change)]}>
              {changeText}
            </TableText>
          </>
        )}
      </View>

      <View style={styles.volumeColumn}>
        {pending ? (
          <>
            <SkeletonText align="right" role="label" width={62} />
            <SkeletonText align="right" role="caption" width={40} />
          </>
        ) : (
          <>
            <TableText style={[styles.primaryValue, volume === null && styles.absent]}>
              {volumeText}
            </TableText>
            <TableText style={styles.secondaryValue}>{openInterestText}</TableText>
          </>
        )}
      </View>
    </Pressable>
  );
}

/**
 * The placeholder is shaped for the eye, not the ear: a screen reader would read
 * it character by character, so the row's label says the value is missing.
 */
function spoken(text: string): string {
  return text === UNAVAILABLE ? 'not reported' : text;
}

/**
 * Every string in the table is one capped, single line. Holding that invariant
 * in one component is what keeps the grid stable: no cell can wrap and grow a
 * row, and no text-size setting can widen a column past its share.
 */
function TableText({
  style,
  children,
}: {
  readonly style: StyleProp<TextStyle>;
  readonly children: string;
}) {
  return (
    <Text maxFontSizeMultiplier={MAX_TEXT_SCALE} numberOfLines={1} style={style}>
      {children}
    </Text>
  );
}

function changeTone(basisPoints: number | null) {
  if (basisPoints === null) {
    return styles.changeUnavailable;
  }

  return basisPoints < 0 ? styles.negative : styles.positive;
}

/**
 * Renders a signed basis-point move as a percentage. The sign carries the
 * direction on its own, so the value never depends on colour to be read.
 */
function formatChange(basisPoints: number): string {
  const absolute = Math.abs(basisPoints);
  const sign = basisPoints >= 0 ? '+' : '-';
  const whole = Math.floor(absolute / 100);
  const fraction = (absolute % 100).toString().padStart(2, '0');

  return `${sign}${whole}.${fraction}%`;
}

const styles = StyleSheet.create({
  // The band and every row own the screen gutter as padding rather than sitting
  // inside a padded list. Their fill and rules therefore run the full width of the
  // screen while the text stays aligned with the title above — a header band that
  // stopped short of both edges read as a cropped rectangle instead of a rule.
  // A rounded card whose inset and inner padding add up to the gutter: the card
  // sits 8pt wider than the text column, and gives that 8pt back as padding, so
  // the labels still start and end exactly where the row values below them do.
  //
  // The padding is what stops the right-most label being clipped: with the card
  // flush to its content, `overflow: hidden` and the corner radius cut the last
  // glyph. Column titles must land on their columns *and* clear the rounded edge,
  // and this is the only arrangement that does both.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    overflow: 'hidden',
    marginHorizontal: layout.screenPadding - spacing.xs,
    marginBottom: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.xs,
  },
  compactStrip: { marginHorizontal: layout.screenPaddingCompact - spacing.xs },
  // Rows carry no fill of their own. The data is the content here, and a gradient
  // repeated down every row read as banding rather than as depth — the raised
  // treatment stays on the chrome that frames the table.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingVertical: spacing.xs,
    paddingHorizontal: layout.screenPadding,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surfaceElevated },
  compactGutter: { paddingHorizontal: layout.screenPaddingCompact },
  // Tracked a half step tighter than the token: at full tracking `24H VOL / OI`
  // measures 81pt against an 80pt column on a 360pt screen, and the trailing gap
  // that letter-spacing adds after the last glyph pushes a right-aligned label
  // off its own edge.
  headerLabel: { ...typography.eyebrow, letterSpacing: 0.5, color: colors.textMuted },
  headerLabelEnd: {
    ...typography.eyebrow,
    letterSpacing: 0.5,
    color: colors.textMuted,
    textAlign: 'right',
  },
  // `flex` sets flexBasis to 0, so each column takes its share of the row and
  // ignores its own content width. That is what aligns the grid across rows.
  marketColumn: {
    flex: COLUMN_FLEX.market,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Indented past the mark so the header sits over the tickers rather than over
  // the logos, which is where the eye reads the column from.
  marketHeader: {
    flex: COLUMN_FLEX.market,
    minWidth: 0,
    paddingLeft: MARKET_LOGO_SIZE + spacing.xs,
  },
  priceColumn: { flex: COLUMN_FLEX.price, minWidth: 0, alignItems: 'flex-end' },
  volumeColumn: { flex: COLUMN_FLEX.volume, minWidth: 0, alignItems: 'flex-end' },
  // The two lines share one left edge and one flex context, so the ticker and
  // the name stay flush with each other whatever either one contains.
  identity: { flexShrink: 1, minWidth: 0 },
  tickerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    minWidth: 0,
  },
  symbol: { ...typography.label, flexShrink: 1, color: colors.textPrimary },
  marketName: { ...typography.caption, color: colors.textMuted },
  // Outlined rather than filled, like the ticket's leverage control: the accent
  // edge marks it as a venue parameter without adding a block of colour to every
  // row, and an unfilled pill sits quieter next to the ticker it qualifies.
  leverageBadge: {
    flexShrink: 0,
    paddingHorizontal: spacing.xxs,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  leverageText: { ...typography.eyebrow, letterSpacing: 0, color: colors.accentSoft },
  // No `fontVariant: ['tabular-nums']`: Poppins ships proportional figures and
  // no `tnum` feature, so the declaration would be inert. Column alignment comes
  // from the fixed shares above and right-aligned text, not from glyph widths.
  primaryValue: {
    ...typography.label,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  secondaryValue: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'right',
  },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  /** Placeholder tone: a value the venue has not reported is never full white. */
  absent: { color: colors.textMuted },
  changeUnavailable: { color: colors.textMuted },
});
