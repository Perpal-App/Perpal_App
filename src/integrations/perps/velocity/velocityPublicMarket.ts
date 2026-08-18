import { amountFromBaseUnits, parseAmount, type Amount } from '@/domain/money/amount';

const PRICE_DECIMALS = 6 as const;
const BASE_DECIMALS = 9 as const;
const QUOTE_SCALE = 1_000_000_000n;
const MAX_LEVELS = 1_000;
const MAX_RESPONSE_CHARACTERS = 1_000_000;

export const VELOCITY_BOOK_AGGREGATIONS = [1, 10, 100, 1000, 10000] as const;
export type VelocityBookAggregation = (typeof VELOCITY_BOOK_AGGREGATIONS)[number];

export type VelocityOrderBookLevel = {
  readonly price: Amount;
  readonly amount: Amount;
  readonly notional: Amount;
  readonly orderCount: number;
};

export type VelocityOrderBook = {
  readonly asks: readonly VelocityOrderBookLevel[];
  readonly bids: readonly VelocityOrderBookLevel[];
  readonly marketIndex: number;
  readonly marketName: string;
  readonly markPrice: Amount;
  readonly oraclePrice: Amount;
  readonly publishedAtMs: number;
  readonly slot: number;
};

export type VelocityPublicTrade = {
  readonly amount: Amount;
  readonly cause: string;
  readonly key: string;
  readonly marketIndex: number;
  readonly price: Amount;
  readonly publishedAtMs: number;
  readonly side: string;
};

export type VelocityPublicMarketMessage =
  | { readonly channel: 'book'; readonly book: VelocityOrderBook }
  | { readonly channel: 'trades'; readonly trades: readonly VelocityPublicTrade[] };

export async function fetchVelocityOrderBook(input: {
  readonly apiOrigin: string;
  readonly marketIndex: number;
  readonly marketName: string;
  readonly signal?: AbortSignal;
}): Promise<VelocityOrderBook> {
  const url = new URL('/l2', input.apiOrigin);
  url.searchParams.set('marketName', input.marketName);
  url.searchParams.set('depth', '30');
  url.searchParams.set('includeVamm', 'true');
  url.searchParams.set('includeIndicative', 'true');
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    method: 'GET',
    signal: input.signal ?? null,
  });
  if (!response.ok) throw new Error(`Velocity depth returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARACTERS) {
    throw new Error('Velocity depth response is too large.');
  }
  return parseVelocityOrderBook(JSON.parse(text) as unknown, input.marketName, input.marketIndex);
}

export function parseVelocityPublicMarketMessage(
  value: unknown,
  marketName: string,
  marketIndex: number,
): VelocityPublicMarketMessage | null {
  const decoded = decodeJson(value);
  if (typeof decoded === 'string') return null;
  const message = object(decoded, 'stream message');
  const channel = text(message.channel, 'stream channel');
  if (channel === 'heartbeat' || channel.startsWith('subscribe')) return null;
  const data = decodeJson(message.data);
  if (channel.startsWith(`orderbook_perp_${marketIndex}`)) {
    return {
      channel: 'book',
      book: parseVelocityOrderBook(data, marketName, marketIndex),
    };
  }
  if (channel === `trades_perp_${marketIndex}`) {
    const entries = Array.isArray(data) ? data : [data];
    return {
      channel: 'trades',
      trades: entries.map((entry, index) => parseVelocityTrade(entry, marketIndex, index)),
    };
  }
  return null;
}

export function parseVelocityOrderBook(
  value: unknown,
  marketName: string,
  marketIndex: number,
): VelocityOrderBook {
  const book = object(decodeJson(value), 'order book');
  if (text(book.marketName, 'market name') !== marketName) {
    throw invalid('order book market');
  }
  if (integer(book.marketIndex, 'market index') !== marketIndex) {
    throw invalid('order book market index');
  }
  const bids = levels(book.bids, 'bid').sort((left, right) => compare(right.price, left.price));
  const asks = levels(book.asks, 'ask').sort((left, right) => compare(left.price, right.price));
  return {
    asks,
    bids,
    marketIndex,
    marketName,
    markPrice: rawAmount(book.markPrice, PRICE_DECIMALS, 'mark price'),
    oraclePrice: rawAmount(
      book.oracleData === undefined ? book.oracle : object(book.oracleData, 'oracle data').price,
      PRICE_DECIMALS,
      'oracle price',
    ),
    publishedAtMs: timestamp(book.ts),
    slot: integer(book.slot, 'slot'),
  };
}

function parseVelocityTrade(
  value: unknown,
  marketIndex: number,
  index: number,
): VelocityPublicTrade {
  const trade = object(decodeJson(value), 'public trade');
  if (
    text(trade.marketType, 'trade market type') !== 'perp' ||
    integer(trade.marketIndex, 'trade market index') !== marketIndex
  ) {
    throw invalid('public trade market');
  }
  const amount = decimalAmount(trade.baseAssetAmountFilled, BASE_DECIMALS, 'trade amount');
  const quote = decimalAmount(trade.quoteAssetAmountFilled, PRICE_DECIMALS, 'trade quote');
  const direction = text(trade.takerOrderDirection, 'trade direction').toLowerCase();
  if (direction !== 'long' && direction !== 'short') throw invalid('trade direction');
  const publishedAtMs = timestamp(trade.ts);
  const priceBaseUnits = (
    quote.baseUnits * QUOTE_SCALE + amount.baseUnits / 2n
  ) / amount.baseUnits;
  const fillRecordId = optionalInteger(trade.fillRecordId, 'fill record id');
  const slot = integer(trade.slot, 'trade slot');
  return {
    amount,
    cause: slug(text(trade.actionExplanation ?? trade.action, 'trade cause')),
    key: fillRecordId === null
      ? `${marketIndex}:${slot}:${publishedAtMs}:${priceBaseUnits}:${index}`
      : `${marketIndex}:fill:${fillRecordId}`,
    marketIndex,
    price: amountFromBaseUnits(priceBaseUnits, PRICE_DECIMALS),
    publishedAtMs,
    side: direction === 'long' ? 'buy_long' : 'sell_short',
  };
}

function levels(value: unknown, side: string): VelocityOrderBookLevel[] {
  if (!Array.isArray(value) || value.length > MAX_LEVELS) throw invalid(`${side} levels`);
  return value.map((entry) => {
    const level = object(entry, `${side} level`);
    const price = rawAmount(level.price, PRICE_DECIMALS, `${side} price`);
    const amount = rawAmount(level.size, BASE_DECIMALS, `${side} size`);
    const sources = level.sources === undefined ? {} : object(level.sources, `${side} sources`);
    return {
      amount,
      notional: amountFromBaseUnits(
        (price.baseUnits * amount.baseUnits + QUOTE_SCALE / 2n) / QUOTE_SCALE,
        PRICE_DECIMALS,
      ),
      orderCount: Object.keys(sources).length,
      price,
    };
  });
}

function rawAmount(value: unknown, decimals: 6 | 9, label: string): Amount {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof raw !== 'string' || !/^\d+$/u.test(raw)) throw invalid(label);
  const amount = amountFromBaseUnits(BigInt(raw), decimals);
  if (amount.baseUnits <= 0n) throw invalid(label);
  return amount;
}

function decimalAmount(value: unknown, decimals: 6 | 9, label: string): Amount {
  const raw = typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(decimals)
    : value;
  if (typeof raw !== 'string' || !/^\d+(?:\.\d+)?$/u.test(raw)) throw invalid(label);
  try {
    const amount = parseAmount(raw, decimals);
    if (amount.baseUnits <= 0n) throw invalid(label);
    return amount;
  } catch {
    throw invalid(label);
  }
}

function decodeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function timestamp(value: unknown): number {
  const parsed = integer(value, 'timestamp');
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
  return value === undefined || value === null ? null : integer(value, label);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw invalid(label);
  }
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(label);
  }
  return value as Record<string, unknown>;
}

function slug(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toLowerCase() || 'normal';
}

function compare(left: Amount, right: Amount): number {
  return left.baseUnits < right.baseUnits ? -1 : left.baseUnits > right.baseUnits ? 1 : 0;
}

function invalid(label: string): Error {
  return new Error(`Velocity returned invalid ${label}.`);
}
