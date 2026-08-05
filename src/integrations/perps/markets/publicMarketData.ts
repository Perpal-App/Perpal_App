import { fetch } from 'expo/fetch';

import {
  amountFromBaseUnits,
  type Amount,
  type TokenDecimals,
} from '@/domain/money/amount';

const EXPECTED_SYMBOLS = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'] as const;
const MAX_PRICE_AGE_MS = 5_000;
const MAX_FUTURE_SKEW_MS = 10_000;
const STREAM_IDLE_TIMEOUT_MS = 10_000;

export type PublicMarketSymbol = (typeof EXPECTED_SYMBOLS)[number];

export type PublicMarketPrice = {
  readonly symbol: PublicMarketSymbol;
  readonly price: Amount;
  readonly confidence: Amount;
  readonly publishedAtMs: number;
  readonly source: 'Pyth Hermes';
  readonly stale: boolean;
};

export async function fetchPublicMarketPrices(
  url: string,
  signal: AbortSignal,
): Promise<readonly PublicMarketPrice[]> {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Market data returned HTTP ${response.status}.`);
  }

  return parsePublicMarketPrices(await response.json(), Date.now());
}

export async function streamPublicMarketPrices(
  url: string,
  signal: AbortSignal,
  onPrices: (prices: readonly PublicMarketPrice[]) => void,
): Promise<void> {
  const response = await fetch(url, {
    headers: { accept: 'text/event-stream' },
    signal,
  });

  if (!response.ok || response.body === null) {
    throw new Error(`Market stream returned HTTP ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await readStreamChunk(reader);

      if (done) {
        throw new Error('Market stream ended.');
      }

      buffer = `${buffer}${decoder.decode(value)}`.replaceAll('\r\n', '\n');
      const boundary = buffer.lastIndexOf('\n\n');

      if (boundary < 0) {
        continue;
      }

      const frames = buffer.slice(0, boundary).split('\n\n');
      buffer = buffer.slice(boundary + 2);

      for (const frame of frames) {
        const prices = parsePublicMarketStreamFrame(frame, Date.now());

        if (prices !== null) {
          onPrices(prices);
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function parsePublicMarketStreamFrame(
  frame: string,
  nowMs: number,
): readonly PublicMarketPrice[] | null {
  const lines = frame.split(/\r?\n/u);
  const event = lines.find((line) => line.startsWith('event:'));

  if (event?.slice(6).trim() !== 'prices') {
    return null;
  }

  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');

  if (data.length === 0) {
    throw new Error('Market stream returned an empty price event.');
  }

  return parsePublicMarketPrices(JSON.parse(data) as unknown, nowMs);
}

export function parsePublicMarketPrices(
  value: unknown,
  nowMs: number,
): readonly PublicMarketPrice[] {
  const root = record(value);

  if (
    root.network !== 'mainnet' ||
    root.source !== 'Pyth Hermes' ||
    !Array.isArray(root.markets) ||
    root.markets.length !== EXPECTED_SYMBOLS.length
  ) {
    throw new Error('The market-data gateway returned an invalid catalog.');
  }

  const markets = new Map<PublicMarketSymbol, PublicMarketPrice>();

  for (const rawMarket of root.markets) {
    const market = record(rawMarket);

    if (!isMarketSymbol(market.symbol) || markets.has(market.symbol)) {
      throw new Error('The market-data gateway returned duplicate markets.');
    }

    const price = integer(market.price, false);
    const confidence = integer(market.confidence, true);
    const exponent = market.exponent;
    const publishedAtMs = market.publishedAtMs;

    if (
      price === null ||
      confidence === null ||
      typeof exponent !== 'number' ||
      !Number.isInteger(exponent) ||
      typeof publishedAtMs !== 'number' ||
      !Number.isSafeInteger(publishedAtMs) ||
      publishedAtMs <= 0
    ) {
      throw new Error('The market-data gateway returned invalid prices.');
    }

    const ageMs = nowMs - publishedAtMs;
    markets.set(market.symbol, {
      symbol: market.symbol,
      price: oracleAmount(price, exponent),
      confidence: oracleAmount(confidence, exponent),
      publishedAtMs,
      source: 'Pyth Hermes',
      stale: ageMs > MAX_PRICE_AGE_MS || ageMs < -MAX_FUTURE_SKEW_MS,
    });
  }

  return EXPECTED_SYMBOLS.map((symbol) => {
    const market = markets.get(symbol);

    if (market === undefined) {
      throw new Error(`The market-data gateway omitted ${symbol}.`);
    }

    return market;
  });
}

function oracleAmount(value: bigint, exponent: number): Amount {
  if (!Number.isInteger(exponent) || exponent < -9 || exponent > 0) {
    throw new Error('The market-data gateway returned an unsupported exponent.');
  }

  const sourceDecimals = -exponent;
  const decimals: TokenDecimals =
    sourceDecimals === 6 || sourceDecimals === 8 || sourceDecimals === 9
      ? sourceDecimals
      : 9;

  return amountFromBaseUnits(
    value * 10n ** BigInt(decimals - sourceDecimals),
    decimals,
  );
}

function isMarketSymbol(value: unknown): value is PublicMarketSymbol {
  return EXPECTED_SYMBOLS.includes(value as PublicMarketSymbol);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The market-data gateway returned an invalid response.');
  }

  return value as Record<string, unknown>;
}

function integer(value: unknown, allowZero: boolean): bigint | null {
  if (typeof value !== 'string' || !/^[0-9]+$/u.test(value)) {
    return null;
  }

  const parsed = BigInt(value);
  return parsed > 0n || (allowZero && parsed === 0n) ? parsed : null;
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Market stream stopped updating.')),
          STREAM_IDLE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
