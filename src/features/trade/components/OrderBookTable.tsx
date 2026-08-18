import { StyleSheet, Text, View } from 'react-native';

import {
  amountFromBaseUnits,
  formatAmountWithCommas,
  formatCompactUsd,
  type Amount,
} from '@/domain/money/amount';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export type OrderBookLevelView = {
  readonly price: Amount;
  readonly amount: Amount;
  readonly notional: Amount;
  readonly orderCount: number;
};

export type OrderBookView = {
  readonly bids: readonly OrderBookLevelView[];
  readonly asks: readonly OrderBookLevelView[];
  readonly publishedAtMs: number;
};

/**
 * How much width the ladder has, which is the only thing that changes about it.
 *
 * `split` is the half-width column beside the order ticket. Three numeric columns do not
 * fit in the ~150pt that leaves — they wrapped every price and every cumulative total
 * onto a second line, which is what made the split book unreadable — so it drops the one
 * that carries the least: the size of a single level, which the depth bar behind the row
 * already shows in proportion. `full` is the Order book tab, which affords all three.
 */
export type OrderBookWidth = 'full' | 'split';

/**
 * Row metrics, exported through `orderBookTableHeight` so a caller's loading placeholder
 * reserves the height the real ladder will occupy and the panel does not resize under the
 * reader when the first snapshot lands. They are minimums on the rows themselves, so
 * scaled-up text still grows them.
 */
const ROW_HEIGHT = 26;
const HEADER_HEIGHT = 20;
const SPREAD_HEIGHT = 30;
const BALANCE_HEIGHT = 26;

/** Shared with the rest of the screen: a figure the venue has not sent. */
const UNAVAILABLE = '--.--';

export function orderBookTableHeight(depth: number): number {
  return HEADER_HEIGHT + depth * 2 * ROW_HEIGHT + SPREAD_HEIGHT + BALANCE_HEIGHT;
}

/**
 * Asks descending into the spread, then bids, then how the resting depth divides.
 *
 * `depth` is the number of levels rendered per side, and it matters more than it looks:
 * Pacifica returns up to a thousand and this table used to render every one of them, so
 * beside a ticket that ends after one screen the book ran several screens past it and the
 * two columns shared no baseline at all.
 */
export function OrderBookTable({
  book,
  depth,
  width,
}: {
  readonly book: OrderBookView;
  readonly depth: number;
  readonly width: OrderBookWidth;
}) {
  // Cumulative totals and the depth scale are both taken over the visible rows, so the
  // longest bar belongs to the last row on screen. Scaling to levels the reader cannot
  // see leaves every bar a stub.
  const asks = cumulativeRows(book.asks.slice(0, depth));
  const bids = cumulativeRows(book.bids.slice(0, depth));
  const maximum = [asks.at(-1)?.total.baseUnits ?? 0n, bids.at(-1)?.total.baseUnits ?? 0n]
    .reduce((largest, value) => value > largest ? value : largest, 1n);

  return (
    <View style={styles.table}>
      <BookHeader width={width} />
      {[...asks].reverse().map(({ level, total }, index) => (
        <BookRow
          key={`ask:${level.price.baseUnits}:${index}`}
          level={level}
          maximum={maximum}
          side="ask"
          total={total}
          width={width}
        />
      ))}
      <SpreadRow book={book} width={width} />
      {bids.map(({ level, total }, index) => (
        <BookRow
          key={`bid:${level.price.baseUnits}:${index}`}
          level={level}
          maximum={maximum}
          side="bid"
          total={total}
          width={width}
        />
      ))}
      <BookBalance book={book} />
    </View>
  );
}

/**
 * Column labels.
 *
 * The split ladder says `Total` rather than `Total (USD)` because the unit does not fit
 * beside a six-figure price at that width, and the screen has already established it
 * three times over: the instrument is `-USD`, the ticket's mark price is suffixed USD,
 * and the price-step menu lists its steps in USD. Every row still names the unit to a
 * screen reader.
 */
function BookHeader({ width }: { readonly width: OrderBookWidth }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.headerRow}
    >
      <Text numberOfLines={1} style={[styles.header, styles.priceCell]}>Price</Text>
      {width === 'full' ? (
        <Text numberOfLines={1} style={[styles.header, styles.sizeCell]}>Size (USD)</Text>
      ) : null}
      <Text numberOfLines={1} style={[styles.header, styles.totalCell]}>
        {width === 'full' ? 'Total (USD)' : 'Total'}
      </Text>
    </View>
  );
}

function BookRow({
  level,
  maximum,
  side,
  total,
  width,
}: {
  readonly level: OrderBookLevelView;
  readonly maximum: bigint;
  readonly side: 'bid' | 'ask';
  readonly total: Amount;
  readonly width: OrderBookWidth;
}) {
  const price = formatAmountWithCommas(level.price);
  const cumulative = formatBookUsd(total);

  return (
    <View
      accessible
      accessibilityLabel={
        `${side === 'bid' ? 'Bid' : 'Ask'} ${price} USD, ${cumulative} USD cumulative`
      }
      style={styles.row}
    >
      <View
        pointerEvents="none"
        style={[
          styles.depthBar,
          side === 'bid' ? styles.bidBar : styles.askBar,
          { width: `${depthPercent(total.baseUnits, maximum)}%` },
        ]}
      />
      <Text
        numberOfLines={1}
        style={[styles.cell, styles.priceCell, side === 'bid' ? styles.bidText : styles.askText]}
      >
        {price}
      </Text>
      {width === 'full' ? (
        <Text numberOfLines={1} style={[styles.cell, styles.sizeCell]}>
          {formatBookUsd(level.notional)}
        </Text>
      ) : null}
      <Text numberOfLines={1} style={[styles.cell, styles.totalCell]}>{cumulative}</Text>
    </View>
  );
}

/** The gap between the two sides, on the rule that separates them. */
function SpreadRow({
  book,
  width,
}: {
  readonly book: OrderBookView;
  readonly width: OrderBookWidth;
}) {
  const percent = orderBookSpreadPercent(book) ?? UNAVAILABLE;
  const price = spreadPrice(book);

  return (
    <View accessible accessibilityLabel={`Spread ${price} USD, ${percent}`} style={styles.spreadRow}>
      <Text numberOfLines={1} style={[styles.spreadLabel, styles.priceCell]}>Spread</Text>
      {width === 'full' ? (
        <Text numberOfLines={1} style={[styles.spreadValue, styles.sizeCell]}>{price}</Text>
      ) : null}
      <Text numberOfLines={1} style={[styles.spreadValue, styles.totalCell]}>{percent}</Text>
    </View>
  );
}

/**
 * How the book's resting liquidity divides between the two sides.
 *
 * Whole percentages, and the ask share is derived from the bid rather than rounded on its
 * own, so the two always read as one hundred.
 */
function BookBalance({ book }: { readonly book: OrderBookView }) {
  const bids = totalLiquidity(book.bids);
  const asks = totalLiquidity(book.asks);
  const total = bids + asks;
  const bidTenths = total === 0n ? 500n : (bids * 1000n + total / 2n) / total;
  const bidPercent = (bidTenths + 5n) / 10n;

  return (
    <View
      accessible
      accessibilityLabel={`Resting depth ${bidPercent}% bids, ${100n - bidPercent}% asks`}
      style={styles.balance}
    >
      <View style={[styles.balanceBid, { flexGrow: Number(bidTenths) }]}>
        <Text numberOfLines={1} style={styles.balanceBidText}>{`B ${bidPercent}%`}</Text>
      </View>
      <View style={[styles.balanceAsk, { flexGrow: Number(1000n - bidTenths) }]}>
        <Text numberOfLines={1} style={styles.balanceAskText}>{`${100n - bidPercent}% A`}</Text>
      </View>
    </View>
  );
}

function cumulativeRows(levels: readonly OrderBookLevelView[]) {
  let total = 0n;
  return levels.map((level) => {
    total += level.notional.baseUnits;
    return { level, total: amountFromBaseUnits(total, level.notional.decimals) };
  });
}

/**
 * Notional in the book, compacted.
 *
 * A cumulative total runs to seven or eight digits plus cents, which is both wider than
 * any column here and more precision than a ladder is read at. `63.5K` and `1.48M` are
 * the figures a trader compares between rows; the exact notional of the order being
 * placed comes from the ticket, which compacts nothing.
 */
function formatBookUsd(value: Amount): string {
  return formatCompactUsd(value).replace('$', '');
}

function spreadPrice(book: OrderBookView): string {
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  if (bid === undefined || ask === undefined || ask.baseUnits <= bid.baseUnits) return UNAVAILABLE;
  return formatAmountWithCommas(amountFromBaseUnits(ask.baseUnits - bid.baseUnits, ask.decimals));
}

function totalLiquidity(levels: readonly OrderBookLevelView[]): bigint {
  return levels.reduce((total, level) => total + level.notional.baseUnits, 0n);
}

function orderBookSpreadPercent(book: OrderBookView): string | null {
  const bid = book.bids[0]?.price.baseUnits;
  const ask = book.asks[0]?.price.baseUnits;
  if (bid === undefined || ask === undefined || ask <= bid) return null;
  const midTwice = ask + bid;
  const tenThousandths = ((ask - bid) * 2_000_000n + midTwice / 2n) / midTwice;
  const digits = tenThousandths.toString().padStart(5, '0');
  return `${digits.slice(0, -4)}.${digits.slice(-4)}%`;
}

function depthPercent(value: bigint, maximum: bigint): number {
  return Number((value * 1000n) / maximum) / 10;
}

const styles = StyleSheet.create({
  table: { overflow: 'hidden', borderRadius: radii.xs },
  headerRow: { minHeight: HEADER_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs },
  row: { minHeight: ROW_HEIGHT, position: 'relative', flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.xs },
  // Full height and flush to the trailing edge, so consecutive levels read as one
  // continuous shape rather than a stack of separate bars.
  depthBar: { position: 'absolute', top: 0, right: 0, bottom: 0 },
  bidBar: { backgroundColor: colors.depthBid },
  askBar: { backgroundColor: colors.depthAsk },
  header: { ...typography.eyebrow, letterSpacing: 0.4, color: colors.textMuted },
  cell: { ...typography.caption, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  bidText: { color: colors.positive },
  askText: { color: colors.negative },
  // Ratios rather than fixed percentages, and price takes the larger share: it is the
  // widest figure in the table — six figures and a decimal on a large cap — while the
  // compacted totals beside it are never more than seven characters. `flexShrink` on a
  // single line is the backstop when the reader scales text up.
  priceCell: { flexGrow: 11, flexShrink: 1, flexBasis: 0, textAlign: 'left' },
  sizeCell: { flexGrow: 9, flexShrink: 1, flexBasis: 0, textAlign: 'right' },
  totalCell: { flexGrow: 9, flexShrink: 1, flexBasis: 0, textAlign: 'right' },
  spreadRow: { minHeight: SPREAD_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, marginVertical: 1, paddingHorizontal: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  spreadLabel: { ...typography.caption, color: colors.textMuted },
  spreadValue: { ...typography.caption, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  balance: { height: BALANCE_HEIGHT, flexDirection: 'row', marginTop: spacing.xxs, overflow: 'hidden' },
  balanceBid: { minWidth: 0, justifyContent: 'center', paddingLeft: spacing.xs, backgroundColor: colors.depthBidStrong },
  balanceAsk: { minWidth: 0, alignItems: 'flex-end', justifyContent: 'center', paddingRight: spacing.xs, backgroundColor: colors.depthAskStrong },
  balanceBidText: { ...typography.caption, color: colors.positive, fontVariant: ['tabular-nums'] },
  balanceAskText: { ...typography.caption, color: colors.negative, fontVariant: ['tabular-nums'] },
});
