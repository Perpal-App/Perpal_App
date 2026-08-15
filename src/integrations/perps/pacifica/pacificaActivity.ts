import {
  PacificaApiError,
  pacificaGet,
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
  readonly trades: readonly PacificaTradeActivity[];
};

const HISTORY_LIMIT = '50';

export async function fetchPacificaActivity(
  apiOrigin: string,
  account: string,
  signal?: AbortSignal,
): Promise<PacificaActivity> {
  try {
    const [trades, balances] = await Promise.all([
      pacificaGet<unknown>({
        apiOrigin,
        path: '/trades/history',
        query: { account, limit: HISTORY_LIMIT },
        signal,
      }),
      pacificaGet<unknown>({
        apiOrigin,
        path: '/account/balance/history',
        query: { account, limit: HISTORY_LIMIT },
        signal,
      }),
    ]);

    return {
      balances: parsePacificaBalanceActivity(balances),
      trades: parsePacificaTradeActivity(trades),
    };
  } catch (cause) {
    if (
      cause instanceof PacificaApiError &&
      (cause.status === 404 || /account not found/iu.test(cause.message))
    ) {
      return { balances: [], trades: [] };
    }
    throw cause;
  }
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
