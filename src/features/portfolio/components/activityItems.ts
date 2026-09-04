import type {
  PacificaActivity,
  PacificaBalanceActivity,
  PacificaTradeActivity,
} from '@/integrations/perps/pacifica/pacificaActivity';
import type { SolanaWalletActivity } from '@/integrations/solana/solanaWalletActivity';
import type { InAppNotification } from '@/storage/inAppNotifications';
import { privateIdentifier } from '@/storage/privateIdentifier';

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
  walletActivity: readonly SolanaWalletActivity[] = [],
): readonly ActivityItem[] {
  const authoritative = authoritativeCorrelationKeys(remote, walletActivity);
  const detailedTradeTimes = new Set(
    remote?.trades.map((trade) => trade.createdAtMs) ?? [],
  );
  const items: ActivityItem[] = [
    ...(remote?.trades.map(tradeItem) ?? []),
    ...(remote?.balances
      .filter((item) => shouldShowBalanceEvent(item, detailedTradeTimes))
      .map(balanceItem) ?? []),
    ...walletActivity.map(walletItem),
    ...local.filter((item) => (
      isPortfolioActivity(item)
      && !item.correlationKeys.some((key) => authoritative.has(key))
    )).map(localItem),
  ];

  return items.sort(
    (left, right) => right.createdAtMs - left.createdAtMs || left.id.localeCompare(right.id),
  );
}

function authoritativeCorrelationKeys(
  remote: PacificaActivity | null,
  walletActivity: readonly SolanaWalletActivity[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const trade of remote?.trades ?? []) {
    keys.add(correlationKey('pacifica-trade', String(trade.historyId)));
  }
  for (const balance of remote?.balances ?? []) {
    keys.add(correlationKey(
      'pacifica-balance',
      `${balance.createdAtMs}:${balance.eventType}:${balance.amount}:${balance.balance}`,
    ));
  }
  for (const item of walletActivity) keys.add(item.correlationKey);
  return keys;
}

function correlationKey(
  namespace: 'pacifica-balance' | 'pacifica-trade',
  value: string,
): string {
  return `${namespace}:${privateIdentifier(namespace, value)}`;
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
  const kind = balanceKind(item);

  return {
    createdAtMs: item.createdAtMs,
    detail: `Private trading balance ${usd(item.balance)}`,
    id: `balance:${item.createdAtMs}:${item.eventType}:${item.amount}:${item.balance}`,
    kind,
    outcome: isLiquidationEvent(item.eventType) ? 'info' : 'success',
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

function isPortfolioActivity(item: InAppNotification): boolean {
  return item.kind !== 'wallet'
    || item.correlationKeys.some((key) => key.startsWith('solana-transaction:'));
}

function walletItem(item: SolanaWalletActivity): ActivityItem {
  const label = item.wallet === 'transfer'
    ? 'Wallet transfer'
    : item.wallet === 'public' ? 'Public wallet transaction' : 'Private wallet transaction';
  return {
    createdAtMs: item.createdAtMs,
    detail: item.outcome === 'success' ? 'Confirmed on Solana' : 'Failed on Solana',
    id: `solana:${item.id}`,
    kind: 'funding',
    outcome: item.outcome,
    title: label,
    value: null,
  };
}

/**
 * The balance feed is authoritative even when the detailed trade feed is empty or delayed.
 * Suppress a trade-shaped balance event only when a detailed fill exists at the exact provider
 * timestamp; otherwise keeping it is preferable to hiding confirmed account history.
 */
function shouldShowBalanceEvent(
  item: PacificaBalanceActivity,
  detailedTradeTimes: ReadonlySet<number>,
): boolean {
  return !isTradeBalanceEvent(item.eventType) || !detailedTradeTimes.has(item.createdAtMs);
}

function balanceKind(item: PacificaBalanceActivity): ActivityKind {
  if (isTradeBalanceEvent(item.eventType)) return 'trade';
  if (
    item.eventType === 'withdraw'
    || (item.eventType === 'subaccount_transfer' && item.amount.startsWith('-'))
  ) return 'withdrawal';
  return 'funding';
}

function isTradeBalanceEvent(eventType: string): boolean {
  return eventType === 'trade' || isLiquidationEvent(eventType);
}

function isLiquidationEvent(eventType: string): boolean {
  return eventType === 'market_liquidation'
    || eventType === 'backstop_liquidation'
    || eventType === 'adl_liquidation';
}

function balanceTitle(eventType: string): string {
  switch (eventType) {
    case 'deposit': return 'Trading funds deposited';
    case 'deposit_release': return 'Deposit available';
    case 'withdraw': return 'Trading funds withdrawn';
    case 'funding': return 'Funding payment';
    case 'trade': return 'Trade balance updated';
    case 'market_liquidation': return 'Position liquidated';
    case 'backstop_liquidation': return 'Backstop liquidation';
    case 'adl_liquidation': return 'ADL liquidation';
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
