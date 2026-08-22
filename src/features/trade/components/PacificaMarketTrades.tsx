import { StyleSheet, Text, View } from 'react-native';

import { formatAmountWithCommas } from '@/domain/money/amount';
import { usePacificaPublicMarket } from '@/features/trade/hooks/usePacificaPublicMarket';
import type { Amount } from '@/domain/money/amount';
import { colors, spacing, typography } from '@/theme/tokens';

/** Executions kept on screen. The feed holds more; a reader scans the recent ones. */
const VISIBLE_TRADES = 20;

export type MarketTradeView = {
  readonly key: string;
  readonly price: Amount;
  readonly amount: Amount;
  readonly side: string;
  readonly cause: string;
  readonly publishedAtMs: number;
};

/**
 * Pacifica's public taker-trade stream.
 *
 * Split out of the order-book panel because the two only ever shared a set of column
 * styles: the book is a ladder that has to stay narrow enough to sit beside the ticket,
 * while this table is always full width and carries a timestamp per row.
 */
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
          market.status === 'error' ? 'Retrying Pacifica executions' : 'Connecting to Pacifica'}
      </Text>
      <MarketTrades baseAsset={baseAsset} trades={market.trades} />
    </View>
  );
}

/** Also the liquidations tab's table, filtered to liquidation causes by its own panel. */
export function MarketTrades({
  baseAsset,
  emptyText = 'Waiting for the next market trade.',
  trades,
  title = 'Market trades',
}: {
  readonly baseAsset: string;
  readonly emptyText?: string;
  readonly trades: readonly MarketTradeView[];
  readonly title?: string;
}) {
  return (
    <View style={styles.trades}>
      <Text style={styles.title}>{title}</Text>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.row}
      >
        <Text numberOfLines={1} style={[styles.header, styles.priceCell]}>Price (USD)</Text>
        <Text numberOfLines={1} style={[styles.header, styles.sizeCell]}>{`Size (${baseAsset})`}</Text>
        <Text numberOfLines={1} style={[styles.header, styles.timeCell]}>Time</Text>
      </View>
      {trades.length === 0 ? (
        <Text style={styles.empty}>{emptyText}</Text>
      ) : trades.slice(0, VISIBLE_TRADES).map((trade) => (
        <TradeRow baseAsset={baseAsset} key={trade.key} trade={trade} />
      ))}
    </View>
  );
}

function TradeRow({
  baseAsset,
  trade,
}: {
  readonly baseAsset: string;
  readonly trade: MarketTradeView;
}) {
  const long = trade.side.endsWith('long');
  const price = formatAmountWithCommas(trade.price);
  const amount = formatAmountWithCommas(trade.amount);

  return (
    <View
      accessible
      accessibilityLabel={
        `${long ? 'Long' : 'Short'} ${amount} ${baseAsset} at ${price} USD, ` +
        `${formatTime(trade.publishedAtMs)}`
      }
      style={styles.row}
    >
      <Text
        numberOfLines={1}
        style={[styles.cell, styles.priceCell, long ? styles.bidText : styles.askText]}
      >
        {price}
      </Text>
      <View style={styles.sizeStack}>
        <Text numberOfLines={1} style={styles.cell}>{amount}</Text>
        <Text numberOfLines={1} style={styles.cause}>{tradeLabel(trade)}</Text>
      </View>
      <Text numberOfLines={1} style={[styles.cell, styles.timeCell]}>
        {formatTime(trade.publishedAtMs)}
      </Text>
    </View>
  );
}

function tradeLabel(trade: MarketTradeView): string {
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
  panel: { gap: spacing.sm, paddingTop: spacing.xs },
  title: { ...typography.bodyCompact, color: colors.textPrimary },
  status: { ...typography.caption, color: colors.textMuted },
  // The rule above the table separates it from whatever panel is hosting it: the stream
  // status here, the cause filters on the liquidations tab.
  trades: {
    gap: spacing.xxs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  row: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xxs,
  },
  header: { ...typography.eyebrow, letterSpacing: 0.4, color: colors.textMuted },
  cell: { ...typography.caption, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  priceCell: { flexGrow: 10, flexShrink: 1, flexBasis: 0, textAlign: 'left' },
  sizeCell: { flexGrow: 9, flexShrink: 1, flexBasis: 0, textAlign: 'right' },
  sizeStack: { flexGrow: 9, flexShrink: 1, flexBasis: 0, alignItems: 'flex-end' },
  timeCell: { flexGrow: 8, flexShrink: 1, flexBasis: 0, textAlign: 'right' },
  cause: { ...typography.caption, color: colors.textMuted },
  bidText: { color: colors.positive },
  askText: { color: colors.negative },
  empty: {
    ...typography.bodyCompact,
    paddingVertical: spacing.lg,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
