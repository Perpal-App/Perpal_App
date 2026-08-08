import { pacificaGet } from '@/integrations/perps/pacifica/pacificaApi';

const MAX_CANDLES = 300;

export type MarketCandle = {
  readonly timeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

export type MarketTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export const MARKET_TIMEFRAMES: readonly {
  readonly id: MarketTimeframe;
  readonly label: string;
  readonly lookbackMs: number;
}[] = [
  { id: '1m', label: '1m', lookbackMs: 4 * 60 * 60 * 1_000 },
  { id: '5m', label: '5m', lookbackMs: 24 * 60 * 60 * 1_000 },
  { id: '15m', label: '15m', lookbackMs: 3 * 24 * 60 * 60 * 1_000 },
  { id: '1h', label: '1h', lookbackMs: 14 * 24 * 60 * 60 * 1_000 },
  { id: '4h', label: '4h', lookbackMs: 60 * 24 * 60 * 60 * 1_000 },
  { id: '1d', label: '1D', lookbackMs: 300 * 24 * 60 * 60 * 1_000 },
];

export async function fetchPacificaMarketHistory(
  apiOrigin: string,
  symbol: string,
  timeframe: MarketTimeframe,
  signal?: AbortSignal,
): Promise<readonly MarketCandle[]> {
  const definition = MARKET_TIMEFRAMES.find((candidate) => candidate.id === timeframe);
  if (definition === undefined) throw new Error('Unsupported market timeframe.');
  const end = Date.now();
  const data = await pacificaGet<readonly unknown[]>({
    apiOrigin,
    path: '/kline/mark',
    query: {
      symbol,
      interval: timeframe,
      start_time: String(end - definition.lookbackMs),
      end_time: String(end),
      limit: String(MAX_CANDLES),
    },
    signal,
  });
  return parsePacificaCandles(data);
}

export function parsePacificaCandles(value: unknown): readonly MarketCandle[] {
  if (!Array.isArray(value) || value.length > MAX_CANDLES) {
    throw new Error('Pacifica returned an invalid candle catalog.');
  }
  return value.map((entry, index) => {
    const candle = object(entry);
    const timeMs = integer(candle.t);
    const open = positive(candle.o);
    const high = positive(candle.h);
    const low = positive(candle.l);
    const close = positive(candle.c);
    if (
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      (index > 0 && timeMs <= integer(object(value[index - 1]).t))
    ) {
      throw new Error('Pacifica returned an inconsistent candle.');
    }
    return { timeMs, open, high, low, close };
  });
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Pacifica returned an invalid candle.');
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('Pacifica returned an invalid candle time.');
  }
  return parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
}

function positive(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Pacifica returned an invalid candle price.');
  }
  return parsed;
}
