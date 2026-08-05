export const MARKET_DATA_PATH = '/v1/markets';

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
  const url = new URL('/v2/updates/price/latest', config.origin);

  for (const asset of MARKET_ASSETS) {
    url.searchParams.append('ids[]', config.feedIds[asset]);
  }

  url.searchParams.set('parsed', 'true');
  url.searchParams.set('ignore_invalid_price_ids', 'false');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      ...(config.apiKey === null
        ? {}
        : { headers: { authorization: `Bearer ${config.apiKey}` } }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Pyth Hermes returned HTTP ${response.status}.`);
    }

    const body = await response.text();

    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error('Pyth Hermes returned an oversized response.');
    }

    return {
      network: 'mainnet',
      source: 'Pyth Hermes',
      fetchedAtMs: Date.now(),
      markets: parsePythResponse(JSON.parse(body) as unknown, config.feedIds),
    };
  } finally {
    clearTimeout(timeout);
  }
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
