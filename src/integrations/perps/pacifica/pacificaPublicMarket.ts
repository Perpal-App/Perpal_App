import {
  amountFromBaseUnits,
  parseAmount,
  type Amount,
} from '@/domain/money/amount';
import { pacificaGet } from '@/integrations/perps/pacifica/pacificaApi';

const DECIMALS = 10 as const;
const FUNDING_DECIMALS = 12;
const SCALE = 10n ** BigInt(DECIMALS);

export const PACIFICA_BOOK_AGGREGATIONS = [1, 10, 100, 1000, 10000] as const;
export type PacificaBookAggregation = (typeof PACIFICA_BOOK_AGGREGATIONS)[number];

export type PacificaOrderBookLevel = {
  readonly price: Amount;
  readonly amount: Amount;
  readonly notional: Amount;
  readonly orderCount: number;
};

export type PacificaOrderBook = {
  readonly symbol: string;
  readonly bids: readonly PacificaOrderBookLevel[];
  readonly asks: readonly PacificaOrderBookLevel[];
  readonly publishedAtMs: number;
  readonly lastOrderId: number | null;
};

export type PacificaPublicTrade = {
  readonly key: string;
  readonly symbol: string;
  readonly price: Amount;
  readonly amount: Amount;
  readonly side: string;
  readonly cause: string;
  readonly publishedAtMs: number;
  readonly lastOrderId: number | null;
};

export type PacificaFundingPoint = {
  readonly oraclePrice: Amount;
  readonly bidImpactPrice: Amount;
  readonly askImpactPrice: Amount;
  readonly fundingRate: string;
  readonly nextFundingRate: string;
  readonly fundingRateBaseUnits: bigint;
  readonly publishedAtMs: number;
};

export type PacificaPublicMarketMessage =
  | { readonly channel: 'book'; readonly book: PacificaOrderBook }
  | { readonly channel: 'trades'; readonly trades: readonly PacificaPublicTrade[] };

export async function fetchPacificaOrderBook(
  apiOrigin: string,
  symbol: string,
  aggregation: PacificaBookAggregation,
  signal?: AbortSignal,
): Promise<PacificaOrderBook> {
  const data = await pacificaGet<unknown>({
    apiOrigin,
    path: '/book',
    query: { symbol, agg_level: String(aggregation) },
    signal,
  });
  return parsePacificaOrderBook(data);
}

export async function fetchPacificaRecentTrades(
  apiOrigin: string,
  symbol: string,
  signal?: AbortSignal,
): Promise<readonly PacificaPublicTrade[]> {
  const data = await pacificaGet<unknown>({
    apiOrigin,
    path: '/trades',
    query: { symbol },
    signal,
  });
  return parsePacificaPublicTrades(data, symbol);
}

export async function fetchPacificaFundingHistory(
  apiOrigin: string,
  symbol: string,
  limit: number,
  signal?: AbortSignal,
): Promise<readonly PacificaFundingPoint[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4000) {
    throw new Error('Pacifica funding history limit is invalid.');
  }
  const data = await pacificaGet<unknown>({
    apiOrigin,
    path: '/funding_rate/history',
    query: { symbol, limit: String(limit) },
    signal,
  });
  return parsePacificaFundingHistory(data);
}

export function parsePacificaPublicMarketMessage(
  value: unknown,
): PacificaPublicMarketMessage | null {
  const message = object(value, 'WebSocket message');
  if (message.channel === 'book') {
    return { channel: 'book', book: parsePacificaOrderBook(message.data) };
  }
  if (message.channel === 'trades') {
    return {
      channel: 'trades',
      trades: parsePacificaPublicTrades(message.data, ''),
    };
  }
  return null;
}

export function parsePacificaOrderBook(value: unknown): PacificaOrderBook {
  const book = object(value, 'order book');
  if (!Array.isArray(book.l) || book.l.length !== 2) {
    throw invalid('order book levels');
  }
  const bids = levels(book.l[0], 'bid').sort((left, right) => compare(right.price, left.price));
  const asks = levels(book.l[1], 'ask').sort((left, right) => compare(left.price, right.price));
  return {
    symbol: text(book.s, 'order book symbol'),
    bids,
    asks,
    publishedAtMs: timestamp(book.t),
    lastOrderId: optionalInteger(book.li, 'last order id'),
  };
}

export function parsePacificaPublicTrades(
  value: unknown,
  fallbackSymbol: string,
): readonly PacificaPublicTrade[] {
  if (!Array.isArray(value)) throw invalid('public trades');
  return value.map((entry, index) => {
    const trade = object(entry, 'public trade');
    const price = positiveAmount(trade.p ?? trade.price, 'trade price');
    const amount = positiveAmount(trade.a ?? trade.amount, 'trade amount');
    const side = text(trade.d ?? trade.side, 'trade side');
    const cause = text(trade.tc ?? trade.cause, 'trade cause');
    const publishedAtMs = timestamp(trade.t ?? trade.created_at);
    const symbol = trade.s === undefined ? fallbackSymbol : text(trade.s, 'trade symbol');
    if (symbol.length === 0) throw invalid('trade symbol');
    const historyId = optionalInteger(trade.h, 'trade history id');
    return {
      key: historyId === null
        ? `${publishedAtMs}:${price.baseUnits}:${amount.baseUnits}:${side}:${cause}:${index}`
        : `h:${historyId}`,
      symbol,
      price,
      amount,
      side,
      cause,
      publishedAtMs,
      lastOrderId: optionalInteger(trade.li, 'trade last order id'),
    };
  });
}

export function parsePacificaFundingHistory(value: unknown): readonly PacificaFundingPoint[] {
  if (!Array.isArray(value) || value.length > 4000) throw invalid('funding history');
  return value.map((entry) => {
    const point = object(entry, 'funding history point');
    const fundingRate = decimalText(point.funding_rate, 'funding rate');
    return {
      oraclePrice: positiveAmount(point.oracle_price, 'funding oracle price'),
      bidImpactPrice: positiveAmount(point.bid_impact_price, 'bid impact price'),
      askImpactPrice: positiveAmount(point.ask_impact_price, 'ask impact price'),
      fundingRate,
      nextFundingRate: decimalText(point.next_funding_rate, 'next funding rate'),
      fundingRateBaseUnits: decimalBaseUnits(fundingRate, FUNDING_DECIMALS),
      publishedAtMs: timestamp(point.created_at),
    };
  }).sort((left, right) => left.publishedAtMs - right.publishedAtMs);
}

export function totalBookLiquidity(
  levelsToTotal: readonly PacificaOrderBookLevel[],
): Amount {
  return amountFromBaseUnits(
    levelsToTotal.reduce((total, level) => total + level.notional.baseUnits, 0n),
    DECIMALS,
  );
}

export function orderBookSpreadPercent(book: PacificaOrderBook): string | null {
  const bid = book.bids[0]?.price.baseUnits;
  const ask = book.asks[0]?.price.baseUnits;
  if (bid === undefined || ask === undefined || ask <= bid) return null;
  const midTwice = ask + bid;
  const tenThousandths = ((ask - bid) * 2_000_000n + midTwice / 2n) / midTwice;
  const digits = tenThousandths.toString().padStart(5, '0');
  return `${digits.slice(0, -4)}.${digits.slice(-4)}%`;
}

export function orderBookImbalancePercent(book: PacificaOrderBook): string | null {
  const bids = totalBookLiquidity(book.bids).baseUnits;
  const asks = totalBookLiquidity(book.asks).baseUnits;
  const total = bids + asks;
  if (total === 0n) return null;
  const tenths = (bids * 1000n + total / 2n) / total;
  return `${tenths / 10n}.${tenths % 10n}% bids`;
}

function levels(value: unknown, label: string): PacificaOrderBookLevel[] {
  if (!Array.isArray(value) || value.length > 1000) throw invalid(`${label} levels`);
  return value.map((entry) => {
    const level = object(entry, `${label} level`);
    const price = positiveAmount(level.p, `${label} price`);
    const amount = positiveAmount(level.a, `${label} amount`);
    const product = price.baseUnits * amount.baseUnits;
    return {
      price,
      amount,
      notional: amountFromBaseUnits((product + SCALE / 2n) / SCALE, DECIMALS),
      orderCount: integer(level.n, `${label} order count`),
    };
  });
}

function positiveAmount(value: unknown, label: string): Amount {
  const raw = decimalText(value, label);
  try {
    const amount = parseAmount(raw, DECIMALS);
    if (amount.baseUnits <= 0n) throw invalid(label);
    return amount;
  } catch {
    throw invalid(label);
  }
}

function decimalText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/u.test(value)) throw invalid(label);
  return value;
}

function decimalBaseUnits(value: string, decimals: number): bigint {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  if (fraction.length > decimals) throw invalid('funding rate precision');
  const result = BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
  return negative ? -result : result;
}

function timestamp(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw invalid('timestamp');
  }
  return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw invalid(label);
  }
  return parsed;
}

function optionalInteger(value: unknown, label: string): number | null {
  return value === undefined ? null : integer(value, label);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid(label);
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(label);
  return value as Record<string, unknown>;
}

function compare(left: Amount, right: Amount): number {
  return left.baseUnits < right.baseUnits ? -1 : left.baseUnits > right.baseUnits ? 1 : 0;
}

function invalid(label: string): Error {
  return new Error(`Pacifica returned invalid ${label}.`);
}
