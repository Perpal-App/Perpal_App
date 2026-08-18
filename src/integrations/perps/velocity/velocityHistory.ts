import type {
  MarketCandle,
  MarketTimeframe,
} from '@/integrations/perps/pacifica/pacificaHistory';

const MAX_RESPONSE_BYTES = 128 * 1024;

export async function fetchVelocityMarketHistory(
  url: string,
  symbol: string,
  timeframe: MarketTimeframe,
  signal?: AbortSignal,
): Promise<readonly MarketCandle[]> {
  const endpoint = new URL(url);
  endpoint.searchParams.set('symbol', symbol);
  endpoint.searchParams.set('timeframe', timeframe);
  const response = await fetch(
    endpoint.toString(),
    signal === undefined ? undefined : { signal },
  );
  if (!response.ok) throw new Error(`Velocity market history returned HTTP ${response.status}.`);
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('Velocity market history returned an oversized response.');
  }
  const root = object(JSON.parse(body) as unknown);
  if (
    root.source !== 'Pyth Benchmarks' ||
    root.symbol !== symbol ||
    root.timeframe !== timeframe
  ) {
    throw new Error('Velocity market history response did not match the requested market.');
  }
  return parseVelocityCandles(root.candles);
}

export function parseVelocityCandles(value: unknown): MarketCandle[] {
  if (!Array.isArray(value)) throw new Error('Pyth history returned invalid candles.');

  const candles = value.slice(-300).map((entry) => {
    const candle = object(entry);
    const timeMs = number(candle.timeMs);
    const open = number(candle.open);
    const high = number(candle.high);
    const low = number(candle.low);
    const close = number(candle.close);

    if (
      !Number.isSafeInteger(timeMs) ||
      timeMs <= 0 ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) {
      throw new Error('Pyth history returned an invalid candle.');
    }

    return { timeMs, open, high, low, close };
  });

  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index]!.timeMs <= candles[index - 1]!.timeMs) {
      throw new Error('Pyth history returned unordered candles.');
    }
  }

  return candles;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Velocity market history returned an invalid response.');
  }
  return value as Record<string, unknown>;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Pyth history returned an invalid number.');
  }
  return value;
}
