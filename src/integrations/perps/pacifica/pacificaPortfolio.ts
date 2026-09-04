import {
  PacificaApiError,
  pacificaGet,
} from '@/integrations/perps/pacifica/pacificaApi';

export type PacificaPosition = {
  readonly symbol: string;
  readonly side: 'long' | 'short';
  readonly amount: string;
  readonly entryPrice: string;
  readonly margin: string;
  readonly funding: string;
  readonly marginMode: 'isolated' | 'cross';
  readonly liquidationPrice: string | null;
  readonly unrealizedPnl: string | null;
};

export type PacificaOpenOrder = {
  readonly orderId: number;
  readonly clientOrderId: string | null;
  readonly symbol: string;
  readonly side: 'bid' | 'ask';
  readonly price: string;
  readonly initialAmount: string;
  readonly filledAmount: string;
  readonly orderType: string;
  readonly reduceOnly: boolean;
};

export type PacificaPortfolioSnapshot = {
  readonly initialized: boolean;
  readonly balance: string;
  readonly accountEquity: string;
  readonly availableToSpend: string;
  readonly availableToWithdraw: string;
  readonly pendingBalance: string;
  readonly totalMarginUsed: string;
  readonly makerFee: string;
  readonly takerFee: string;
  readonly updatedAtMs: number | null;
  readonly positionsCount: number;
  readonly ordersCount: number;
  readonly stopOrdersCount: number;
  readonly positions: readonly PacificaPosition[];
  readonly orders: readonly PacificaOpenOrder[];
};

export async function fetchPacificaPortfolio(
  apiOrigin: string,
  account: string,
  signal?: AbortSignal,
): Promise<PacificaPortfolioSnapshot> {
  try {
    const [rawAccount, rawPositions, rawOrders] = await Promise.all([
      pacificaGet<unknown>({ apiOrigin, path: '/account', query: { account }, signal }),
      pacificaGet<readonly unknown[]>({ apiOrigin, path: '/positions', query: { account }, signal }),
      pacificaGet<readonly unknown[]>({ apiOrigin, path: '/orders', query: { account }, signal }),
    ]);
    const value = object(rawAccount, 'account');
    return {
      initialized: true,
      balance: decimal(value.balance, 'balance'),
      accountEquity: decimal(value.account_equity, 'account equity'),
      availableToSpend: decimal(value.available_to_spend, 'available balance'),
      availableToWithdraw: decimal(value.available_to_withdraw, 'withdrawable balance'),
      pendingBalance: decimal(value.pending_balance, 'pending balance'),
      totalMarginUsed: decimal(value.total_margin_used, 'margin used'),
      makerFee: decimal(value.maker_fee, 'maker fee'),
      takerFee: decimal(value.taker_fee, 'taker fee'),
      updatedAtMs: optionalTimestamp(value.updated_at),
      positionsCount: nonNegativeInteger(value.positions_count, 'positions count'),
      ordersCount: nonNegativeInteger(value.orders_count, 'orders count'),
      stopOrdersCount: nonNegativeInteger(value.stop_orders_count, 'stop orders count'),
      positions: parsePositions(rawPositions),
      orders: parseOrders(rawOrders),
    };
  } catch (cause) {
    if (
      cause instanceof PacificaApiError &&
      (
        (cause.status === 404 && cause.requestPath === '/api/v1/account') ||
        /account not found/iu.test(cause.message)
      )
    ) {
      return emptyPortfolio();
    }
    throw cause;
  }
}

function parsePositions(value: unknown): readonly PacificaPosition[] {
  if (!Array.isArray(value)) throw invalid('positions');
  return value.map((entry) => {
    const position = object(entry, 'position');
    const side = text(position.side, 'position side');
    if (side !== 'bid' && side !== 'ask') throw invalid('position side');
    return {
      symbol: text(position.symbol, 'position symbol'),
      side: side === 'bid' ? 'long' : 'short',
      amount: decimal(position.amount, 'position amount'),
      entryPrice: decimal(position.entry_price, 'entry price'),
      margin: decimal(position.margin, 'margin'),
      funding: decimal(position.funding, 'funding'),
      marginMode: boolean(position.isolated, 'margin mode') ? 'isolated' : 'cross',
      liquidationPrice: nullableDecimal(position.liquidation_price, 'liquidation price'),
      unrealizedPnl: nullableDecimal(position.unrealized_pnl ?? position.pnl, 'unrealized PnL'),
    };
  });
}

function parseOrders(value: unknown): readonly PacificaOpenOrder[] {
  if (!Array.isArray(value)) throw invalid('orders');
  return value.map((entry) => {
    const order = object(entry, 'order');
    const side = text(order.side, 'order side');
    if (side !== 'bid' && side !== 'ask') throw invalid('order side');
    return {
      orderId: integer(order.order_id, 'order id'),
      clientOrderId: nullableText(order.client_order_id, 'client order id'),
      symbol: text(order.symbol, 'order symbol'),
      side,
      price: decimal(order.price, 'order price'),
      initialAmount: decimal(order.initial_amount, 'initial order amount'),
      filledAmount: decimal(order.filled_amount, 'filled order amount'),
      orderType: text(order.order_type, 'order type'),
      reduceOnly: boolean(order.reduce_only, 'reduce only'),
    };
  });
}

function emptyPortfolio(): PacificaPortfolioSnapshot {
  return {
    initialized: false,
    balance: '0',
    accountEquity: '0',
    availableToSpend: '0',
    availableToWithdraw: '0',
    pendingBalance: '0',
    totalMarginUsed: '0',
    makerFee: '0',
    takerFee: '0',
    updatedAtMs: null,
    positionsCount: 0,
    ordersCount: 0,
    stopOrdersCount: 0,
    positions: [],
    orders: [],
  };
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
  if (value === null || value === undefined) return null;
  return text(value, label);
}
function decimal(value: unknown, label: string): string {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof raw !== 'string' || !/^-?\d+(?:\.\d+)?$/u.test(raw)) throw invalid(label);
  return raw;
}
function nullableDecimal(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return decimal(value, label);
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw invalid(label);
  return value;
}
function integer(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed)) throw invalid(label);
  return parsed;
}
function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = integer(value, label);
  if (parsed < 0) throw invalid(label);
  return parsed;
}
function optionalTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw invalid('account timestamp');
  }
  return parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
}
function invalid(label: string): Error {
  return new Error(`Pacifica returned invalid ${label}.`);
}
