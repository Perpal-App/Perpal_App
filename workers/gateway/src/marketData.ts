export const MARKET_DATA_PATH = '/v1/markets';
export const MARKET_STREAM_PATH = `${MARKET_DATA_PATH}/stream`;

const MAX_RESPONSE_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 5_000;
const MARKET_ASSETS = ['BTC', 'ETH', 'SOL'] as const;

export type MarketAsset = (typeof MARKET_ASSETS)[number];

export type MarketDataConfig = {
  readonly origin: string;
  readonly feedIds: Readonly<Record<MarketAsset, string>>;
  readonly apiKey: string | null;
};

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
