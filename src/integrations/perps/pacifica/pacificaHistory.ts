import { pacificaGet } from '@/integrations/perps/pacifica/pacificaApi';

const MAX_CANDLES = 300;

export type MarketCandle = {
  readonly timeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

export type MarketTimeframe =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '8h'
  | '12h'
  | '1d'
  | '1w'
  | '1M';

export const MARKET_TIMEFRAMES: readonly {
  readonly id: MarketTimeframe;
  readonly label: string;
  readonly intervalMs: number;
}[] = [
  { id: '1m', label: '1m', intervalMs: 60_000 },
  { id: '3m', label: '3m', intervalMs: 3 * 60_000 },
  { id: '5m', label: '5m', intervalMs: 5 * 60_000 },
  { id: '15m', label: '15m', intervalMs: 15 * 60_000 },
  { id: '30m', label: '30m', intervalMs: 30 * 60_000 },
  { id: '1h', label: '1h', intervalMs: 60 * 60_000 },
  { id: '2h', label: '2h', intervalMs: 2 * 60 * 60_000 },
  { id: '4h', label: '4h', intervalMs: 4 * 60 * 60_000 },
  { id: '8h', label: '8h', intervalMs: 8 * 60 * 60_000 },
  { id: '12h', label: '12h', intervalMs: 12 * 60 * 60_000 },
  { id: '1d', label: '1D', intervalMs: 24 * 60 * 60_000 },
  { id: '1w', label: '1W', intervalMs: 7 * 24 * 60 * 60_000 },
  { id: '1M', label: '1M', intervalMs: 30 * 24 * 60 * 60_000 },
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
      start_time: String(end - definition.intervalMs * MAX_CANDLES),
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
