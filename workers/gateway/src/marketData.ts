export const MARKET_DATA_PATH = '/v1/markets';
export const MARKET_HISTORY_PATH = `${MARKET_DATA_PATH}/history`;
export const MARKET_STREAM_PATH = `${MARKET_DATA_PATH}/stream`;

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_HISTORY_RESPONSE_BYTES = 512 * 1024;
const MAX_HISTORY_CANDLES = 300;
const UPSTREAM_TIMEOUT_MS = 5_000;
const MARKET_ASSETS = ['BTC', 'ETH', 'SOL'] as const;
const HISTORY_ASSETS = ['BTC', 'ETH', 'SOL', 'HYPE'] as const;

export type MarketAsset = (typeof MARKET_ASSETS)[number];

export type MarketDataConfig = {
  readonly origin: string;
  readonly historyOrigin: string;
  readonly feedIds: Readonly<Record<MarketAsset, string>>;
  readonly apiKey: string | null;
};

type MarketHistoryAsset = (typeof HISTORY_ASSETS)[number];
type MarketHistoryTimeframe = keyof typeof HISTORY_DEFINITIONS;
type MarketHistoryInput = {
  readonly asset: MarketHistoryAsset;
  readonly timeframe: MarketHistoryTimeframe;
};

const HISTORY_DEFINITIONS = {
  '1m': { resolution: '1', intervalSeconds: 60 },
  '3m': { resolution: '1', intervalSeconds: 3 * 60 },
  '5m': { resolution: '5', intervalSeconds: 5 * 60 },
  '15m': { resolution: '15', intervalSeconds: 15 * 60 },
  '30m': { resolution: '30', intervalSeconds: 30 * 60 },
  '1h': { resolution: '60', intervalSeconds: 60 * 60 },
  '2h': { resolution: '120', intervalSeconds: 2 * 60 * 60 },
  '4h': { resolution: '240', intervalSeconds: 4 * 60 * 60 },
  '8h': { resolution: '240', intervalSeconds: 8 * 60 * 60 },
  '12h': { resolution: '720', intervalSeconds: 12 * 60 * 60 },
  '1d': { resolution: 'D', intervalSeconds: 24 * 60 * 60 },
  '1w': { resolution: 'W', intervalSeconds: 7 * 24 * 60 * 60 },
  '1M': { resolution: 'M', intervalSeconds: 30 * 24 * 60 * 60 },
} as const;

export type PublicMarketPrice = {
  readonly symbol: `${MarketAsset}-PERP`;
  readonly price: string;
  readonly confidence: string;
  readonly exponent: number;
  readonly publishedAtMs: number;
};

export type PublicMarketsResponse = {
  readonly network: 'mainnet';
  readonly source: 'Pyth Hermes';
  readonly fetchedAtMs: number;
  readonly markets: readonly PublicMarketPrice[];
};

export type PublicMarketCandle = {
  readonly timeMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
};

export type PublicMarketHistoryResponse = {
  readonly source: 'Pyth Benchmarks';
  readonly symbol: MarketHistoryAsset;
  readonly timeframe: MarketHistoryTimeframe;
  readonly fetchedAtMs: number;
  readonly candles: readonly PublicMarketCandle[];
};

export function parseMarketHistoryInput(url: URL): MarketHistoryInput | null {
  const symbols = url.searchParams.getAll('symbol');
  const timeframes = url.searchParams.getAll('timeframe');
  const asset = symbols[0];
  const timeframe = timeframes[0];

  if (
    [...url.searchParams.keys()].some((key) => key !== 'symbol' && key !== 'timeframe') ||
    symbols.length !== 1 ||
    timeframes.length !== 1 ||
    !HISTORY_ASSETS.some((candidate) => candidate === asset) ||
    !Object.hasOwn(HISTORY_DEFINITIONS, timeframe ?? '')
  ) {
    return null;
  }

  return {
    asset: asset as MarketHistoryAsset,
    timeframe: timeframe as MarketHistoryTimeframe,
  };
}

export async function fetchMainnetMarketHistory(
  config: MarketDataConfig,
  input: MarketHistoryInput,
): Promise<PublicMarketHistoryResponse> {
  const definition = HISTORY_DEFINITIONS[input.timeframe];
  const to = Math.floor(Date.now() / 1_000);
  const from = to - definition.intervalSeconds * MAX_HISTORY_CANDLES;
  const url = new URL('/v1/shims/tradingview/history', config.historyOrigin);
  url.searchParams.set('symbol', `Crypto.${input.asset}/USD`);
  url.searchParams.set('resolution', definition.resolution);
  url.searchParams.set('from', String(from));
  url.searchParams.set('to', String(to));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: config.apiKey === null ? {} : { authorization: `Bearer ${config.apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Pyth Benchmarks returned HTTP ${response.status}.`);
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_HISTORY_RESPONSE_BYTES) {
      throw new Error('Pyth Benchmarks returned an oversized response.');
    }
    return {
      source: 'Pyth Benchmarks',
      symbol: input.asset,
      timeframe: input.timeframe,
      fetchedAtMs: Date.now(),
      candles: parsePythHistory(
        JSON.parse(body) as unknown,
        input.timeframe === '3m' || input.timeframe === '8h'
          ? definition.intervalSeconds
          : null,
      ),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function parsePythHistory(
  value: unknown,
  aggregateIntervalSeconds: number | null,
): readonly PublicMarketCandle[] {
  const root = record(value);
  const timestamps = root.t;
  const opens = root.o;
  const highs = root.h;
  const lows = root.l;
  const closes = root.c;
  if (
    root.s !== 'ok' ||
    !Array.isArray(timestamps) ||
    !Array.isArray(opens) ||
    !Array.isArray(highs) ||
    !Array.isArray(lows) ||
    !Array.isArray(closes) ||
    [opens, highs, lows, closes].some((array) => array.length !== timestamps.length) ||
    timestamps.length > 1_000
  ) {
    throw new Error('Pyth Benchmarks returned invalid candle data.');
  }

  const buckets = new Map<number, PublicMarketCandle>();
  let previousTime = 0;
  for (let index = 0; index < timestamps.length; index += 1) {
    const time = positiveInteger(timestamps[index]);
    const open = positiveNumber(opens[index]);
    const high = positiveNumber(highs[index]);
    const low = positiveNumber(lows[index]);
    const close = positiveNumber(closes[index]);
    if (
      time <= previousTime ||
      high < Math.max(open, close) ||
      low > Math.min(open, close)
    ) {
      throw new Error('Pyth Benchmarks returned an inconsistent candle.');
    }
    previousTime = time;
    const timeMs = (aggregateIntervalSeconds === null
      ? time
      : Math.floor(time / aggregateIntervalSeconds) * aggregateIntervalSeconds) * 1_000;
    const current = buckets.get(timeMs);
    buckets.set(timeMs, current === undefined
      ? { timeMs, open, high, low, close }
      : {
          timeMs,
          open: current.open,
          high: Math.max(current.high, high),
          low: Math.min(current.low, low),
          close,
        });
  }
  return [...buckets.values()].slice(-MAX_HISTORY_CANDLES);
}

export async function fetchMainnetMarkets(
  config: MarketDataConfig,
): Promise<PublicMarketsResponse> {
  const url = pythUrl('/v2/updates/price/latest', config);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: pythHeaders(config),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Pyth Hermes returned HTTP ${response.status}.`);
    }

    const body = await response.text();

    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('Pyth Hermes returned an oversized response.');
    }

    return marketResponse(JSON.parse(body) as unknown, config.feedIds);
  } finally {
    clearTimeout(timeout);
  }
}

export async function streamMainnetMarkets(
  config: MarketDataConfig,
  signal: AbortSignal,
): Promise<Response> {
  const upstream = await fetch(
    pythUrl('/v2/updates/price/stream', config).toString(),
    {
      headers: { ...pythHeaders(config), accept: 'text/event-stream' },
      signal,
    },
  );

  if (!upstream.ok || upstream.body === null) {
    throw new Error(`Pyth Hermes stream returned HTTP ${upstream.status}.`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(': connected\n\n'));
    },
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          controller.close();
          return;
        }

        buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replaceAll(
          '\r\n',
          '\n',
        );
        const boundary = buffer.lastIndexOf('\n\n');

        if (boundary < 0) {
          continue;
        }

        const frames = buffer.slice(0, boundary).split('\n\n');
        buffer = buffer.slice(boundary + 2);

        for (const frame of frames) {
          const update = parsePythStreamFrame(frame, config.feedIds);

          if (update !== null) {
            controller.enqueue(
              encoder.encode(`event: prices\ndata: ${JSON.stringify(update)}\n\n`),
            );
          }
        }

        return;
      }
    },
    cancel() {
      return reader.cancel();
    },
  });

  return new Response(body, {
    headers: {
      'cache-control': 'no-cache, no-store, no-transform',
      'content-type': 'text/event-stream; charset=utf-8',
    },
  });
}

export function parsePythStreamFrame(
  frame: string,
  feedIds: Readonly<Record<MarketAsset, string>>,
): PublicMarketsResponse | null {
  const data = frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  return data.length === 0
    ? null
    : marketResponse(JSON.parse(data) as unknown, feedIds);
}

export function parsePythResponse(
  value: unknown,
  feedIds: Readonly<Record<MarketAsset, string>>,
): readonly PublicMarketPrice[] {
  const root = record(value);
  const parsed = root.parsed;

  if (!Array.isArray(parsed) || parsed.length !== MARKET_ASSETS.length) {
    throw new Error('Pyth Hermes did not return every configured price feed.');
  }

  const byFeedId = new Map<string, Record<string, unknown>>();

  for (const entry of parsed) {
    const update = record(entry);

    if (typeof update.id !== 'string' || byFeedId.has(update.id)) {
      throw new Error('Pyth Hermes returned an invalid price feed set.');
    }

    byFeedId.set(update.id, record(update.price));
  }

  return MARKET_ASSETS.map((asset) => {
    const price = byFeedId.get(feedIds[asset]);

    if (price === undefined) {
      throw new Error(`Pyth Hermes omitted ${asset}/USD.`);
    }

    return parsePrice(`${asset}-PERP`, price);
  });
}

function parsePrice(
  symbol: PublicMarketPrice['symbol'],
  price: Record<string, unknown>,
): PublicMarketPrice {
  const rawPrice = integerString(price.price, false);
  const confidence = integerString(price.conf, true);
  const exponent = price.expo;
  const publishTime = price.publish_time;

  if (
    rawPrice === null ||
    confidence === null ||
    typeof exponent !== 'number' ||
    !Number.isInteger(exponent) ||
    exponent < -9 ||
    exponent > 0 ||
    typeof publishTime !== 'number' ||
    !Number.isSafeInteger(publishTime) ||
    publishTime <= 0 ||
    publishTime > Math.floor(Number.MAX_SAFE_INTEGER / 1_000)
  ) {
    throw new Error(`Pyth Hermes returned invalid ${symbol} price data.`);
  }

  return {
    symbol,
    price: rawPrice,
    confidence,
    exponent,
    publishedAtMs: publishTime * 1_000,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Pyth Hermes returned an invalid response.');
  }

  return value as Record<string, unknown>;
}

function integerString(value: unknown, allowZero: boolean): string | null {
  if (typeof value !== 'string' || !/^-?[0-9]+$/u.test(value)) {
    return null;
  }

  const parsed = BigInt(value);
  return parsed > 0n || (allowZero && parsed === 0n) ? value : null;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Pyth Benchmarks returned an invalid candle time.');
  }
  return value;
}

function positiveNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('Pyth Benchmarks returned an invalid candle price.');
  }
  return value;
}

function marketResponse(
  value: unknown,
  feedIds: Readonly<Record<MarketAsset, string>>,
): PublicMarketsResponse {
  return {
    network: 'mainnet',
    source: 'Pyth Hermes',
    fetchedAtMs: Date.now(),
    markets: parsePythResponse(value, feedIds),
  };
}

function pythUrl(path: string, config: MarketDataConfig): URL {
  const url = new URL(path, config.origin);

  for (const asset of MARKET_ASSETS) {
    url.searchParams.append('ids[]', config.feedIds[asset]);
  }

  url.searchParams.set('parsed', 'true');
  url.searchParams.set('ignore_invalid_price_ids', 'false');
  return url;
}

function pythHeaders(config: MarketDataConfig): Record<string, string> {
  return config.apiKey === null
    ? {}
    : { authorization: `Bearer ${config.apiKey}` };
}
