import {
  isPacificaRateLimited,
  PacificaApiError,
  pacificaGetPage,
  type PacificaPage,
} from '@/integrations/perps/pacifica/pacificaApi';

export type PacificaTradeActivity = {
  readonly amount: string;
  readonly cause: 'normal' | 'market_liquidation' | 'backstop_liquidation' | 'settlement';
  readonly clientOrderId: string | null;
  readonly createdAtMs: number;
  readonly fee: string;
  readonly historyId: number;
  readonly orderId: number;
  readonly pnl: string;
  readonly price: string;
  readonly side: 'open_long' | 'open_short' | 'close_long' | 'close_short';
  readonly symbol: string;
};

export type PacificaOrderActivity = {
  readonly amount: string;
  readonly averageFilledPrice: string;
  readonly clientOrderId: string | null;
  readonly createdAtMs: number;
  readonly filledAmount: string;
  readonly initialPrice: string;
  readonly orderId: number;
  readonly orderStatus: string;
  readonly orderType: string;
  readonly reason: string | null;
  readonly reduceOnly: boolean;
  readonly side: 'ask' | 'bid';
  readonly symbol: string;
  readonly updatedAtMs: number;
};

export type PacificaBalanceActivity = {
  readonly amount: string;
  readonly balance: string;
  readonly createdAtMs: number;
  readonly eventType: string;
};

export type PacificaActivity = {
  readonly balances: readonly PacificaBalanceActivity[];
  readonly incomplete: boolean;
  readonly orders: readonly PacificaOrderActivity[];
  readonly trades: readonly PacificaTradeActivity[];
  readonly truncated: boolean;
};

const HISTORY_LIMIT = '100';
const MAX_HISTORY_PAGES = 10;
const MAX_HISTORY_ITEMS = 1_000;
const DIAGNOSTIC_REPEAT_AFTER_MS = 30_000;

let lastDiagnostic = '';
let lastDiagnosticAtMs = 0;

type HistoryResult<T> = {
  readonly items: readonly T[];
  readonly truncated: boolean;
};

type Settled<T> = {
  readonly data: T | null;
  readonly error: unknown;
};

export async function fetchPacificaActivity(
  apiOrigin: string,
  account: string,
  signal?: AbortSignal,
  mode: 'backfill' | 'latest' = 'latest',
  freshness: 'cached' | 'network' = 'cached',
): Promise<PacificaActivity> {
  const maxPages = mode === 'backfill' ? MAX_HISTORY_PAGES : 1;
  const [trades, balances, orders] = await Promise.all([
    settle(fetchHistory({
      account,
      apiOrigin,
      maxPages,
      parse: parsePacificaTradeActivity,
      path: '/trades/history',
      freshness,
      ...(signal === undefined ? {} : { signal }),
    })),
    settle(fetchHistory({
      account,
      apiOrigin,
      includeTrades: true,
      maxPages,
      parse: parsePacificaBalanceActivity,
      path: '/account/balance/history',
      freshness,
      ...(signal === undefined ? {} : { signal }),
    })),
    settle(fetchHistory({
      account,
      apiOrigin,
      maxPages,
      parse: parsePacificaOrderActivity,
      path: '/orders/history',
      freshness,
      ...(signal === undefined ? {} : { signal }),
    })),
  ]);

  logActivityDiagnostic({ balances, freshness, mode, orders, trades });

  if (trades.data === null && balances.data === null && orders.data === null) {
    const rateLimit = [trades.error, balances.error, orders.error].find(isPacificaRateLimited);
    throw rateLimit ?? trades.error ?? balances.error ?? orders.error;
  }

  return {
    balances: balances.data?.items ?? [],
    incomplete: trades.data === null || balances.data === null || orders.data === null,
    orders: orders.data?.items ?? [],
    trades: trades.data?.items ?? [],
    truncated: mode === 'backfill'
      && (
        trades.data?.truncated === true
        || balances.data?.truncated === true
        || orders.data?.truncated === true
      ),
  };
}

export function mergePacificaActivity(
  previous: PacificaActivity,
  latest: PacificaActivity,
): PacificaActivity {
  const trades = unique(
    previous.trades,
    latest.trades,
    (trade) => String(trade.historyId),
  );
  const balances = unique(
    previous.balances,
    latest.balances,
    balanceKey,
  );
  const orders = uniqueOrders(previous.orders, latest.orders);

  return {
    balances,
    incomplete: latest.incomplete,
    orders,
    trades,
    truncated: previous.truncated || latest.truncated,
  };
}

async function fetchHistory<T>(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly includeTrades?: boolean;
  readonly maxPages: number;
  readonly freshness: 'cached' | 'network';
  readonly parse: (value: unknown) => readonly T[];
  readonly path: string;
  readonly signal?: AbortSignal;
}): Promise<HistoryResult<T>> {
  const items: T[] = [];
  let cursor: string | null = null;

  try {
    for (let pageNumber = 0; pageNumber < input.maxPages; pageNumber += 1) {
      const page: PacificaPage<unknown> = await pacificaGetPage<unknown>({
        apiOrigin: input.apiOrigin,
        freshness: input.freshness,
        path: input.path,
        query: {
          account: input.account,
          ...(input.includeTrades === true ? { include_trades: 'true' } : {}),
          limit: HISTORY_LIMIT,
          ...(cursor === null ? {} : { cursor }),
        },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      items.push(...input.parse(page.data));
      if (!page.hasMore) return { items, truncated: false };
      if (page.nextCursor === cursor) throw invalid('history pagination');
      cursor = page.nextCursor;
    }

    return { items, truncated: true };
  } catch (cause) {
    if (
      cause instanceof PacificaApiError &&
      (cause.status === 404 || /account not found/iu.test(cause.message))
    ) {
      return { items: [], truncated: false };
    }
    throw cause;
  }
}

function logActivityDiagnostic(input: {
  readonly balances: Settled<HistoryResult<PacificaBalanceActivity>>;
  readonly freshness: 'cached' | 'network';
  readonly mode: 'backfill' | 'latest';
  readonly orders: Settled<HistoryResult<PacificaOrderActivity>>;
  readonly trades: Settled<HistoryResult<PacificaTradeActivity>>;
}): void {
  if (!__DEV__) return;
  const diagnostic = JSON.stringify({
    balanceCount: input.balances.data?.items.length ?? 0,
    balanceError: diagnosticError(input.balances.error),
    event: 'history_result',
    cachePolicy: input.freshness,
    includeTrades: true,
    incomplete: input.balances.data === null
      || input.trades.data === null
      || input.orders.data === null,
    mode: input.mode,
    orderCount: input.orders.data?.items.length ?? 0,
    orderError: diagnosticError(input.orders.error),
    tradeCount: input.trades.data?.items.length ?? 0,
    tradeError: diagnosticError(input.trades.error),
    truncated: input.balances.data?.truncated === true
      || input.trades.data?.truncated === true
      || input.orders.data?.truncated === true,
  });
  const now = Date.now();
  if (diagnostic === lastDiagnostic && now - lastDiagnosticAtMs < DIAGNOSTIC_REPEAT_AFTER_MS) {
    return;
  }
  lastDiagnostic = diagnostic;
  lastDiagnosticAtMs = now;
  console.info('[Perpal Pacifica activity]', diagnostic);
}

function diagnosticError(cause: unknown): Readonly<Record<string, unknown>> | null {
  if (cause === null || cause === undefined) return null;
  return cause instanceof PacificaApiError
    ? {
        code: cause.code,
        name: cause.name,
        requestPath: cause.requestPath,
        status: cause.status,
      }
    : { name: cause instanceof Error ? cause.name : typeof cause };
}

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { data: await promise, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

function unique<T extends { readonly createdAtMs: number }>(
  previous: readonly T[],
  latest: readonly T[],
  key: (item: T) => string,
): readonly T[] {
  const values = new Map(previous.map((item) => [key(item), item]));
  for (const item of latest) values.set(key(item), item);
  return [...values.values()]
    .sort((left, right) => right.createdAtMs - left.createdAtMs)
    .slice(0, MAX_HISTORY_ITEMS);
}

function balanceKey(item: PacificaBalanceActivity): string {
  return `${item.createdAtMs}:${item.eventType}:${item.amount}:${item.balance}`;
}

function uniqueOrders(
  previous: readonly PacificaOrderActivity[],
  latest: readonly PacificaOrderActivity[],
): readonly PacificaOrderActivity[] {
  const values = new Map(previous.map((item) => [item.orderId, item]));
  for (const item of latest) values.set(item.orderId, item);
  return [...values.values()]
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, MAX_HISTORY_ITEMS);
}

export function parsePacificaTradeActivity(value: unknown): readonly PacificaTradeActivity[] {
  if (!Array.isArray(value)) throw invalid('trade history');

  return value.map((entry) => {
    const trade = object(entry, 'trade history entry');
    const side = oneOf(
      trade.side,
      ['open_long', 'open_short', 'close_long', 'close_short'] as const,
      'trade side',
    );
    const cause = oneOf(
      trade.cause,
      ['normal', 'market_liquidation', 'backstop_liquidation', 'settlement'] as const,
      'trade cause',
    );

    return {
      amount: decimal(trade.amount, 'trade amount'),
      cause,
      clientOrderId: nullableText(trade.client_order_id, 'trade client order id'),
      createdAtMs: timestamp(trade.created_at, 'trade time'),
      fee: decimal(trade.fee, 'trade fee'),
      historyId: integer(trade.history_id, 'trade history id'),
      orderId: integer(trade.order_id, 'trade order id'),
      pnl: decimal(trade.pnl, 'trade PnL'),
      price: decimal(trade.price, 'trade price'),
      side,
      symbol: text(trade.symbol, 'trade symbol'),
    };
  });
}

export function parsePacificaOrderActivity(value: unknown): readonly PacificaOrderActivity[] {
  if (!Array.isArray(value)) throw invalid('order history');

  return value.map((entry) => {
    const order = object(entry, 'order history entry');
    const createdAtMs = timestamp(order.created_at, 'order creation time');
    return {
      amount: decimal(order.amount, 'order amount'),
      averageFilledPrice: decimal(order.average_filled_price, 'average filled price'),
      clientOrderId: nullableText(order.client_order_id, 'client order id'),
      createdAtMs,
      filledAmount: decimal(order.filled_amount, 'filled amount'),
      initialPrice: decimal(order.initial_price, 'initial order price'),
      orderId: integer(order.order_id, 'order id'),
      orderStatus: text(order.order_status, 'order status'),
      orderType: text(order.order_type, 'order type'),
      reason: nullableText(order.reason, 'order reason'),
      reduceOnly: booleanValue(order.reduce_only, 'reduce only'),
      side: oneOf(order.side, ['ask', 'bid'] as const, 'order side'),
      symbol: text(order.symbol, 'order symbol'),
      updatedAtMs: order.updated_at === undefined
        ? createdAtMs
        : timestamp(order.updated_at, 'order update time'),
    };
  });
}

export function parsePacificaBalanceActivity(value: unknown): readonly PacificaBalanceActivity[] {
  if (!Array.isArray(value)) throw invalid('balance history');

  return value.map((entry) => {
    const activity = object(entry, 'balance history entry');
    return {
      amount: decimal(activity.amount, 'balance change'),
      balance: decimal(activity.balance, 'resulting balance'),
      createdAtMs: timestamp(activity.created_at, 'balance event time'),
      eventType: text(activity.event_type, 'balance event type'),
    };
  });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(label);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid(label);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  return text(value, label);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw invalid(label);
  return value;
}

function decimal(value: unknown, label: string): string {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof raw !== 'string' || !/^-?\d+(?:\.\d+)?$/u.test(raw)) throw invalid(label);
  return raw;
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) throw invalid(label);
  return parsed;
}

function timestamp(value: unknown, label: string): number {
  const parsed = integer(value, label);
  if (parsed <= 0) throw invalid(label);
  return parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw invalid(label);
  return value as T[number];
}

function invalid(label: string): Error {
  return new Error(`Pacifica returned invalid ${label}.`);
}
