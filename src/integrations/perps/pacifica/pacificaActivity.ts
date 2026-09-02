import {
  PacificaApiError,
  pacificaGetPage,
  type PacificaPage,
} from '@/integrations/perps/pacifica/pacificaApi';

export type PacificaTradeActivity = {
  readonly amount: string;
  readonly cause: 'normal' | 'market_liquidation' | 'backstop_liquidation' | 'settlement';
  readonly createdAtMs: number;
  readonly fee: string;
  readonly historyId: number;
  readonly pnl: string;
  readonly price: string;
  readonly side: 'open_long' | 'open_short' | 'close_long' | 'close_short';
  readonly symbol: string;
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
  readonly trades: readonly PacificaTradeActivity[];
  readonly truncated: boolean;
};

const HISTORY_LIMIT = '100';
const MAX_HISTORY_PAGES = 10;
const MAX_HISTORY_ITEMS = 1_000;

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
): Promise<PacificaActivity> {
  const maxPages = mode === 'backfill' ? MAX_HISTORY_PAGES : 1;
  const [trades, balances] = await Promise.all([
    settle(fetchHistory({
      account,
      apiOrigin,
      maxPages,
      parse: parsePacificaTradeActivity,
      path: '/trades/history',
      ...(signal === undefined ? {} : { signal }),
    })),
    settle(fetchHistory({
      account,
      apiOrigin,
      maxPages,
      parse: parsePacificaBalanceActivity,
      path: '/account/balance/history',
      ...(signal === undefined ? {} : { signal }),
    })),
  ]);

  if (trades.data === null && balances.data === null) throw trades.error ?? balances.error;

  return {
    balances: balances.data?.items ?? [],
    incomplete: trades.data === null || balances.data === null,
    trades: trades.data?.items ?? [],
    truncated: mode === 'backfill'
      && (trades.data?.truncated === true || balances.data?.truncated === true),
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

  return {
    balances,
    incomplete: latest.incomplete,
    trades,
    truncated: previous.truncated || latest.truncated,
  };
}

async function fetchHistory<T>(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly maxPages: number;
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
        path: input.path,
        query: {
          account: input.account,
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
      createdAtMs: timestamp(trade.created_at, 'trade time'),
      fee: decimal(trade.fee, 'trade fee'),
      historyId: integer(trade.history_id, 'trade history id'),
      pnl: decimal(trade.pnl, 'trade PnL'),
      price: decimal(trade.price, 'trade price'),
      side,
      symbol: text(trade.symbol, 'trade symbol'),
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
