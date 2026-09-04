import type {
  PacificaActivity,
  PacificaBalanceActivity,
  PacificaTradeActivity,
} from '@/integrations/perps/pacifica/pacificaActivity';
import type { InAppNotification } from '@/storage/inAppNotifications';

/**
 * What a row in the history can be.
 *
 * Three kinds rather than the venue's dozen event types: a trade, value arriving, value leaving.
 * That is the distinction a reader scanning a history actually makes, and it is what the filter
 * chips are built on — a chip per underlying event type would be a menu, not a filter.
 */
export type ActivityKind = 'funding' | 'trade' | 'withdrawal';

export type ActivityItem = {
  readonly createdAtMs: number;
  readonly detail: string;
  readonly id: string;
  readonly kind: ActivityKind;
  readonly outcome: 'error' | 'info' | 'success';
  readonly title: string;
  readonly value: string | null;
};

/**
 * The venue's history and this device's own log, as one list newest first.
 *
 * Local events are included because a private funding or withdrawal step confirmed on the device is
 * real before the venue reports it, and dropping it until the next poll would show a reader nothing
 * for an action they just completed. Ties break on id so the order is stable across polls rather
 * than reshuffling equal timestamps on every refresh.
 */
export function mergeActivity(
  remote: PacificaActivity | null,
  local: readonly InAppNotification[],
): readonly ActivityItem[] {
  const items: ActivityItem[] = [
    ...(remote?.trades.map(tradeItem) ?? []),
    ...(remote?.balances.filter(isFundMovement).map(balanceItem) ?? []),
    ...local.filter((item) => item.kind !== 'wallet').map(localItem),
  ];

  return items.sort(
    (left, right) => right.createdAtMs - left.createdAtMs || left.id.localeCompare(right.id),
  );
}

/**
 * Whether a row answers the search box.
 *
 * Title and detail only. The detail line already carries the market symbol, the size, the price and
 * the fee, so searching those two fields covers "SOL", "liquidat", "0.5" and a date fragment without
 * the screen having to index anything. A blank query matches everything.
 */
export function matchesActivityQuery(item: ActivityItem, query: string): boolean {
  const needle = query.trim().toLowerCase();

  if (needle.length === 0) return true;

  return item.title.toLowerCase().includes(needle)
    || item.detail.toLowerCase().includes(needle);
}

function tradeItem(trade: PacificaTradeActivity): ActivityItem {
  const direction = trade.side.endsWith('long') ? 'long' : 'short';
  const opening = trade.side.startsWith('open');
  const title = trade.cause === 'market_liquidation'
    ? `${trade.symbol} liquidated`
    : trade.cause === 'backstop_liquidation'
      ? `${trade.symbol} backstop liquidation`
      : trade.cause === 'settlement'
        ? `${trade.symbol} settled`
        : `${opening ? 'Opened' : 'Closed'} ${trade.symbol} ${direction}`;

  return {
    createdAtMs: trade.createdAtMs,
    detail: `${trimDecimal(trade.amount)} ${trade.symbol} at ${usd(trade.price)} · Fee ${usd(trade.fee)}`,
    id: `trade:${trade.historyId}`,
    kind: 'trade',
    outcome: trade.cause === 'normal' ? 'success' : 'info',
    title,
    value: opening ? null : signedUsd(trade.pnl),
  };
}

function balanceItem(item: PacificaBalanceActivity): ActivityItem {
  const kind = item.eventType === 'withdraw'
    || (item.eventType === 'subaccount_transfer' && item.amount.startsWith('-'))
    ? 'withdrawal'
    : 'funding';

  return {
    createdAtMs: item.createdAtMs,
    detail: `Private trading balance ${usd(item.balance)}`,
    id: `balance:${item.createdAtMs}:${item.eventType}:${item.amount}:${item.balance}`,
    kind,
    outcome: 'success',
    title: balanceTitle(item.eventType),
    value: signedUsd(item.amount),
  };
}

function localItem(item: InAppNotification): ActivityItem {
  return {
    createdAtMs: item.createdAtMs,
    detail: item.message,
    id: `local:${item.id}`,
    kind: item.kind === 'trade'
      ? 'trade'
      : item.kind === 'withdrawal' ? 'withdrawal' : 'funding',
    outcome: item.outcome,
    title: item.title,
    value: null,
  };
}

/** Trades and liquidations arrive through the trade feed, so the balance feed skips them here. */
function isFundMovement(item: PacificaBalanceActivity): boolean {
  return !['trade', 'market_liquidation', 'backstop_liquidation', 'adl_liquidation']
    .includes(item.eventType);
}

function balanceTitle(eventType: string): string {
  switch (eventType) {
    case 'deposit': return 'Trading funds deposited';
    case 'deposit_release': return 'Deposit available';
    case 'withdraw': return 'Trading funds withdrawn';
    case 'funding': return 'Funding payment';
    case 'payout': return 'Account payout';
    case 'subaccount_transfer': return 'Balance transferred';
    default: return eventType.split('_').map(capitalize).join(' ');
  }
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function signedUsd(value: string): string {
  if (/^-?0+(?:\.0+)?$/u.test(value)) return '$0';
  return value.startsWith('-') ? `-${usd(value.slice(1))}` : `+${usd(value)}`;
}

function usd(value: string): string {
  return `$${trimDecimal(value)}`;
}

/** Groups the venue's decimal string and drops trailing zeros. The value is never recomputed. */
function trimDecimal(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const visibleFraction = fraction.replace(/0+$/u, '');
  const body = visibleFraction.length === 0 ? grouped : `${grouped}.${visibleFraction}`;
  return negative ? `-${body}` : body;
}
