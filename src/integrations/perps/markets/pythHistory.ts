import { fetch } from 'expo/fetch';

const MAX_RESPONSE_BYTES = 256_000;
const MAX_CANDLES = 240;

export type MarketCandle = {
  readonly timeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

export type MarketTimeframe = '1' | '5' | '15' | '60' | '240' | 'D';

export const MARKET_TIMEFRAMES: readonly {
  readonly id: MarketTimeframe;
  readonly label: string;
  readonly lookbackSeconds: number;
}[] = [
  { id: '1', label: '1m', lookbackSeconds: 2 * 60 * 60 },
  { id: '5', label: '5m', lookbackSeconds: 6 * 60 * 60 },
  { id: '15', label: '15m', lookbackSeconds: 24 * 60 * 60 },
  { id: '60', label: '1h', lookbackSeconds: 3 * 24 * 60 * 60 },
  { id: '240', label: '4h', lookbackSeconds: 14 * 24 * 60 * 60 },
  { id: 'D', label: '1D', lookbackSeconds: 90 * 24 * 60 * 60 },
];

export async function fetchPythMarketHistory(
  origin: string,
  ticker: string,
  timeframe: MarketTimeframe,
  signal: AbortSignal,
): Promise<readonly MarketCandle[]> {
  const definition = MARKET_TIMEFRAMES.find((candidate) => candidate.id === timeframe);
  if (definition === undefined) throw new Error('Unsupported market timeframe.');

  const to = Math.floor(Date.now() / 1_000);
  const url = new URL('/v1/shims/tradingview/history', origin);
  url.searchParams.set('symbol', ticker);
  url.searchParams.set('resolution', timeframe);
  url.searchParams.set('from', String(to - definition.lookbackSeconds));
  url.searchParams.set('to', String(to));

  const response = await fetch(url.toString(), {
    headers: { accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Pyth history returned HTTP ${response.status}.`);
  }

  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('Pyth history exceeded the response limit.');
  }

  return parsePythMarketHistory(JSON.parse(body) as unknown);
}

export function parsePythMarketHistory(value: unknown): readonly MarketCandle[] {
  const root = asRecord(value);
  if (root.s === 'no_data') return [];
  if (root.s !== 'ok') throw new Error('Pyth history returned an invalid status.');

  const times = asNumbers(root.t);
  const opens = asNumbers(root.o);
  const highs = asNumbers(root.h);
  const lows = asNumbers(root.l);
  const closes = asNumbers(root.c);
  const length = times.length;

  if (
    length === 0 ||
    length > MAX_CANDLES ||
    [opens, highs, lows, closes].some((series) => series.length !== length)
  ) {
    throw new Error('Pyth history returned inconsistent candles.');
  }

  return times.map((time, index) => {
    const open = opens[index];
    const high = highs[index];
    const low = lows[index];
    const close = closes[index];
    if (
      !Number.isSafeInteger(time) ||
      time <= 0 ||
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      Math.min(open, high, low, close) <= 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      (index > 0 && time <= (times[index - 1] ?? 0))
    ) {
      throw new Error('Pyth history returned an invalid candle.');
    }

    return { timeMs: time * 1_000, open, high, low, close };
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Pyth history returned an invalid object.');
  }
  return value as Record<string, unknown>;
}

function asNumbers(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.some((item) =>
    typeof item !== 'number' || !Number.isFinite(item)
  )) {
    throw new Error('Pyth history returned an invalid series.');
  }
  return value as readonly number[];
}
