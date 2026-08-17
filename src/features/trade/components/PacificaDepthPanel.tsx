import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Skeleton } from '@/components/feedback/Skeleton';
import {
  AnchoredMenu,
  anchorBelow,
  type MenuAnchor,
  type MenuOption,
} from '@/components/ui/AnchoredMenu';
import {
  amountFromBaseUnits,
  formatAmount,
  formatAmountWithCommas,
  formatDetailedUsd,
  parseAmount,
  type Amount,
} from '@/domain/money/amount';
import { usePacificaPublicMarket } from '@/features/trade/hooks/usePacificaPublicMarket';
import {
  orderBookSpreadPercent,
  PACIFICA_BOOK_AGGREGATIONS,
  totalBookLiquidity,
  type PacificaBookAggregation,
  type PacificaOrderBook,
  type PacificaOrderBookLevel,
  type PacificaPublicTrade,
} from '@/integrations/perps/pacifica/pacificaPublicMarket';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

type AggregationId = `${PacificaBookAggregation}`;

export function PacificaDepthPanel({
  apiOrigin,
  symbol,
  tickSize,
  wsOrigin,
}: {
  readonly apiOrigin: string;
  readonly symbol: string;
  readonly tickSize: string;
  readonly wsOrigin: string;
}) {
  const [aggregation, setAggregation] = useState<PacificaBookAggregation>(1);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const market = usePacificaPublicMarket(apiOrigin, wsOrigin, symbol, aggregation);
  const book = market.book;
  const options = useMemo<readonly MenuOption<AggregationId>[]>(
    () => PACIFICA_BOOK_AGGREGATIONS.map((value) => ({
      id: String(value) as AggregationId,
      label: formatPriceStep(tickSize, value),
      detail: 'USD',
    })),
    [tickSize],
  );
  const selectedId = String(aggregation) as AggregationId;
  const selectedStep = options.find((option) => option.id === selectedId)?.label ?? tickSize;

  const openMenu = () => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor(anchorBelow(x, y, width, height, 148));
      setMenuOpen(true);
    });
  };

  return (
    <View style={styles.panel}>
      <View style={styles.toolbar}>
        <View>
          <Text style={styles.title}>Order book</Text>
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {statusLabel(market.status, book?.publishedAtMs ?? null)}
          </Text>
        </View>
        <View ref={anchorRef}>
          <Pressable
            accessibilityLabel={`Price step ${selectedStep} USD`}
            accessibilityRole="button"
            accessibilityState={{ expanded: menuOpen }}
            onPress={openMenu}
            style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
          >
            <Text style={styles.stepLabel}>Price step</Text>
            <Text style={styles.stepValue}>{selectedStep}⌄</Text>
          </Pressable>
        </View>
      </View>

      {book === null ? (
        <Skeleton height={420} radius={radii.sm} />
      ) : (
        <OrderBookTable book={book} />
      )}

      <Text style={styles.source}>Pacifica public order-book stream</Text>
      <AnchoredMenu
        anchor={anchor}
        onClose={() => setMenuOpen(false)}
        onSelect={(next) => {
          setAggregation(Number(next) as PacificaBookAggregation);
          setMenuOpen(false);
        }}
        options={options}
        selected={selectedId}
        title="Price step"
        visible={menuOpen}
      />
    </View>
  );
}

export function PacificaTradesPanel({
  apiOrigin,
  baseAsset,
  symbol,
  wsOrigin,
}: {
  readonly apiOrigin: string;
  readonly baseAsset: string;
  readonly symbol: string;
  readonly wsOrigin: string;
}) {
  const market = usePacificaPublicMarket(apiOrigin, wsOrigin, symbol, 1, false);
  return (
    <View style={styles.panel}>
      <Text accessibilityLiveRegion="polite" style={styles.status}>
        {market.status === 'live' ? 'Live Pacifica executions' :
          market.status === 'error' ? 'Market trades unavailable' : 'Connecting to Pacifica'}
      </Text>
      <MarketTrades baseAsset={baseAsset} trades={market.trades} />
      <Text style={styles.source}>Pacifica public taker-trade stream</Text>
    </View>
  );
}

function OrderBookTable({ book }: { readonly book: PacificaOrderBook }) {
  const asks = cumulativeRows(book.asks);
  const bids = cumulativeRows(book.bids);
  const maximum = [asks.at(-1)?.total.baseUnits ?? 0n, bids.at(-1)?.total.baseUnits ?? 0n]
    .reduce((largest, value) => value > largest ? value : largest, 1n);
  return (
    <View style={styles.table}>
      <TableHeader middle="Size (USD)" right="Total (USD)" />
      {[...asks].reverse().map(({ level, total }, index) => (
        <BookRow
          key={`ask:${level.price.baseUnits}:${index}`}
          level={level}
          maximum={maximum}
          side="ask"
          total={total}
        />
      ))}
      <View style={styles.spreadRow}>
        <Text style={[styles.spreadLabel, styles.left]}>Spread</Text>
        <Text selectable style={[styles.spreadValue, styles.middle]}>{spreadPrice(book)}</Text>
        <Text selectable style={[styles.spreadValue, styles.right]}>
          {orderBookSpreadPercent(book) ?? '--.--'}
        </Text>
      </View>
      {bids.map(({ level, total }, index) => (
        <BookRow
          key={`bid:${level.price.baseUnits}:${index}`}
          level={level}
          maximum={maximum}
          side="bid"
          total={total}
        />
      ))}
      <BookBalance book={book} />
    </View>
  );
}

function TableHeader({ middle, right }: { readonly middle: string; readonly right: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.header, styles.left]}>Price (USD)</Text>
      <Text style={[styles.header, styles.middle]}>{middle}</Text>
      <Text style={[styles.header, styles.right]}>{right}</Text>
    </View>
  );
}

function BookRow({
  level,
  maximum,
  side,
  total,
}: {
  readonly level: PacificaOrderBookLevel;
  readonly maximum: bigint;
  readonly side: 'bid' | 'ask';
  readonly total: Amount;
}) {
  return (
    <View style={styles.row}>
      <View
        pointerEvents="none"
        style={[
          styles.depthBar,
          side === 'bid' ? styles.bidBar : styles.askBar,
          { width: `${depthPercent(total.baseUnits, maximum)}%` },
        ]}
      />
      <Text selectable style={[styles.cell, styles.left, side === 'bid' ? styles.bidText : styles.askText]}>
        {formatAmountWithCommas(level.price)}
      </Text>
      <Text selectable style={[styles.cell, styles.middle]}>
        {formatUsdNumber(level.notional)}
      </Text>
      <Text selectable style={[styles.cell, styles.right]}>
        {formatUsdNumber(total)}
      </Text>
    </View>
  );
}

export function MarketTrades({
  baseAsset,
  emptyText = 'Waiting for the next Pacifica trade.',
  trades,
  title = 'Market trades',
}: {
  readonly baseAsset: string;
  readonly emptyText?: string;
  readonly trades: readonly PacificaPublicTrade[];
  readonly title?: string;
}) {
  return (
    <View style={styles.trades}>
      <Text style={styles.title}>{title}</Text>
      <TableHeader middle={`Size (${baseAsset})`} right="Time" />
      {trades.length === 0 ? (
        <Text style={styles.empty}>{emptyText}</Text>
      ) : trades.slice(0, 20).map((trade) => (
        <View key={trade.key} style={styles.row}>
          <Text selectable style={[
            styles.cell,
            styles.left,
            trade.side.endsWith('long') ? styles.bidText : styles.askText,
          ]}>
            {formatAmountWithCommas(trade.price)}
          </Text>
          <View style={styles.middleStack}>
            <Text numberOfLines={1} selectable style={styles.cell}>{formatAmountWithCommas(trade.amount)}</Text>
            <Text numberOfLines={1} style={styles.orderCount}>{tradeLabel(trade)}</Text>
          </View>
          <Text selectable style={[styles.cell, styles.right]}>{formatTime(trade.publishedAtMs)}</Text>
        </View>
      ))}
    </View>
  );
}

function cumulativeRows(levels: readonly PacificaOrderBookLevel[]) {
  let total = 0n;
  return levels.map((level) => {
    total += level.notional.baseUnits;
    return { level, total: amountFromBaseUnits(total, level.notional.decimals) };
  });
}

function BookBalance({ book }: { readonly book: PacificaOrderBook }) {
  const bids = totalBookLiquidity(book.bids).baseUnits;
  const asks = totalBookLiquidity(book.asks).baseUnits;
  const total = bids + asks;
  const bidTenths = total === 0n ? 500n : (bids * 1000n + total / 2n) / total;
  const askTenths = 1000n - bidTenths;
  return (
    <View style={styles.balance}>
      <View style={[styles.balanceBid, { flexGrow: Number(bidTenths) }]}>
        <Text selectable style={styles.balanceBidText}>B {percentFromTenths(bidTenths)}</Text>
      </View>
      <View style={[styles.balanceAsk, { flexGrow: Number(askTenths) }]}>
        <Text selectable style={styles.balanceAskText}>{percentFromTenths(askTenths)} A</Text>
      </View>
    </View>
  );
}

function formatPriceStep(tickSize: string, aggregation: PacificaBookAggregation): string {
  const tick = parseAmount(tickSize, 10);
  return formatAmount(amountFromBaseUnits(
    tick.baseUnits * BigInt(aggregation),
    tick.decimals,
  ));
}

function formatUsdNumber(value: Amount): string {
  return formatDetailedUsd(value).replace('$', '');
}

function spreadPrice(book: PacificaOrderBook): string {
  const bid = book.bids[0]?.price;
  const ask = book.asks[0]?.price;
  if (bid === undefined || ask === undefined || ask.baseUnits <= bid.baseUnits) return '--.--';
  return formatAmountWithCommas(amountFromBaseUnits(
    ask.baseUnits - bid.baseUnits,
    ask.decimals,
  ));
}

function depthPercent(value: bigint, maximum: bigint): number {
  return Number((value * 1000n) / maximum) / 10;
}

function percentFromTenths(value: bigint): string {
  return `${value / 10n}.${value % 10n}%`;
}

function statusLabel(status: string, publishedAtMs: number | null): string {
  if (status === 'live' && publishedAtMs !== null) return `Live · ${formatTime(publishedAtMs)}`;
  if (status === 'reconnecting') return 'Reconnecting to Pacifica';
  if (status === 'error') return 'Pacifica depth unavailable';
  return 'Loading Pacifica depth';
}

function tradeLabel(trade: PacificaPublicTrade): string {
  const action = trade.side.replace('_', ' ');
  return trade.cause === 'normal' ? action : `${action} · ${trade.cause.replaceAll('_', ' ')}`;
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const styles = StyleSheet.create({
  panel: { gap: spacing.md, paddingTop: spacing.xs },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.heading, color: colors.textPrimary },
  status: { ...typography.caption, color: colors.textMuted },
  stepButton: {
    minHeight: layout.minTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
  },
  stepLabel: { ...typography.eyebrow, color: colors.textMuted },
  stepValue: { ...typography.label, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.72 },
  bidText: { color: colors.positive },
  askText: { color: colors.negative },
  table: { overflow: 'hidden', borderRadius: radii.sm },
  trades: { gap: spacing.xxs, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: {
    minHeight: 42,
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  depthBar: { position: 'absolute', top: 1, right: 0, bottom: 1 },
  bidBar: { backgroundColor: 'rgba(20, 184, 128, 0.19)' },
  askBar: { backgroundColor: 'rgba(239, 68, 96, 0.18)' },
  header: { ...typography.eyebrow, color: colors.textMuted },
  cell: { ...typography.bodyCompact, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  left: { width: '29%', textAlign: 'left' },
  middle: { width: '34%', textAlign: 'right' },
  middleStack: { width: '34%', alignItems: 'flex-end' },
  right: { flex: 1, textAlign: 'right' },
  orderCount: { ...typography.caption, color: colors.textMuted },
  spreadRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  spreadLabel: { ...typography.caption, color: colors.textMuted },
  spreadValue: { ...typography.label, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  balance: { height: 28, flexDirection: 'row', overflow: 'hidden' },
  balanceBid: { minWidth: 0, justifyContent: 'center', paddingLeft: spacing.xs, backgroundColor: 'rgba(20, 184, 128, 0.28)' },
  balanceAsk: { minWidth: 0, alignItems: 'flex-end', justifyContent: 'center', paddingRight: spacing.xs, backgroundColor: 'rgba(239, 68, 96, 0.26)' },
  balanceBidText: { ...typography.caption, color: colors.positive, fontVariant: ['tabular-nums'] },
  balanceAskText: { ...typography.caption, color: colors.negative, fontVariant: ['tabular-nums'] },
  empty: { ...typography.bodyCompact, paddingVertical: spacing.lg, color: colors.textMuted, textAlign: 'center' },
  source: { ...typography.caption, color: colors.textMuted },
});
