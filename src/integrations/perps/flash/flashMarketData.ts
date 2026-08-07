import { PoolConfig, type MarketConfig } from '@flash_trade/flash-sdk-v2/dist/PoolConfig';
import { fetch } from 'expo/fetch';

import { amountFromBaseUnits, type Amount } from '@/domain/money/amount';
import { fetchPublicProgramAccounts } from '@/integrations/api/publicSolanaRpc';
import { decodeFlashMarket } from '@/integrations/perps/flash/flashAccountCoder';
import {
  listFlashPoolNames,
  type MainnetMarket,
} from '@/integrations/perps/markets/mainnetCatalog';

const MAX_ACCOUNTS_PER_REQUEST = 24;
const MAX_MARKET_DATA_BYTES = 128 * 1024;
const MAX_MARKET_ENTRIES = 128;
const MAX_PRICE_AGE_MS = 30_000;
const MAX_FUTURE_SKEW_MS = 10_000;

type FlashVenueSnapshot = {
  readonly symbol: MainnetMarket['symbol'];
  readonly poolName: string;
  readonly venueRef: string;
  readonly longOpenInterest: Amount;
  readonly shortOpenInterest: Amount;
  readonly longOpenPositions: number;
  readonly shortOpenPositions: number;
  readonly slot: number;
};

export type FlashMarketSnapshot = FlashVenueSnapshot & {
  readonly price: Amount | null;
  readonly pricePublishedAtMs: number | null;
  readonly priceStale: boolean;
  readonly change24hBps: number | null;
  readonly volume24h: Amount | null;
};

export async function fetchFlashMarketSnapshots(
  erRpcUrl: string,
  programId: string,
  dataOrigin: string,
  statsOrigin: string,
  markets: readonly MainnetMarket[],
  signal: AbortSignal,
): Promise<readonly FlashMarketSnapshot[]> {
  const byPool = new Map<string, MainnetMarket[]>();

  for (const market of markets) {
    const group = byPool.get(market.poolName) ?? [];
    group.push(market);
    byPool.set(market.poolName, group);
  }

  const [venueSnapshots, prices, changes, stats] = await Promise.all([
    Promise.all(
      [...byPool.entries()].map(([poolName, poolMarkets]) =>
        fetchPoolSnapshots(
          erRpcUrl,
          flashPool(programId, poolName),
          poolMarkets,
          signal,
        ),
      ),
    ).then((groups) => groups.flat()),
    fetchFlashPrices(dataOrigin, signal),
    fetchFlashChanges(statsOrigin, signal),
    fetchFlashStats(statsOrigin, signal),
  ]);
  const marketByRef = new Map(markets.map((market) => [market.venueRef, market]));
  const nowMs = Date.now();

  return venueSnapshots.map((snapshot) => {
    const market = marketByRef.get(snapshot.venueRef);

    if (market === undefined) {
      throw new Error('Flash returned an unknown configured market.');
    }

    const price = prices.get(market.baseAsset.toUpperCase()) ?? null;

    return {
      ...snapshot,
      price: price?.price ?? null,
      pricePublishedAtMs: price?.publishedAtMs ?? null,
      priceStale: price === null || isPriceStale(price.publishedAtMs, nowMs),
      change24hBps: changes.get(market.oracleSymbol.toUpperCase()) ?? null,
      volume24h: stats.get(market.baseAsset.toUpperCase()) ?? null,
    };
  });
}

export function flashPool(
  programId: string,
  poolName = 'Crypto.1',
): PoolConfig {
  const pool = PoolConfig.fromIdsByName(poolName, 'mainnet-beta');

  if (pool.programId.toBase58() !== programId) {
    throw new Error('Configured Flash program does not match the SDK catalog.');
  }

  return pool;
}

export function flashPools(programId: string): readonly PoolConfig[] {
  return listFlashPoolNames().map((poolName) => flashPool(programId, poolName));
}

async function fetchPoolSnapshots(
  erRpcUrl: string,
  pool: PoolConfig,
  markets: readonly MainnetMarket[],
  signal: AbortSignal,
): Promise<readonly FlashVenueSnapshot[]> {
  const entries = markets.flatMap((market) =>
    marketConfigs(pool, market).map((config) => ({ config, market })),
  );
  const responses = await Promise.all(
    chunks(entries, MAX_ACCOUNTS_PER_REQUEST).map((batch) =>
      fetchPublicProgramAccounts(
        erRpcUrl,
        batch.map(({ config }) => config.marketAccount.toBase58()),
        pool.programId.toBase58(),
        signal,
      ),
    ),
  );
  const accounts = responses.flatMap((response) => response.accounts);
  const slot = Math.max(...responses.map((response) => response.slot));

  return markets.map((market) => {
    const directions = entries
      .map((entry, index) => ({ ...entry, data: accounts[index] }))
      .filter((entry) => entry.market.venueRef === market.venueRef)
      .map(({ config, data }) => {
        if (data === undefined) {
          throw new Error('Flash ER omitted a configured market account.');
        }

        const account = decodeFlashMarket(data);
        const configuredSide = side(config);
        const accountSide = 'long' in account.side
          ? 'long'
          : 'short' in account.side
            ? 'short'
            : null;

        if (
          !account.pool.equals(pool.poolAddress) ||
          !account.targetCustody.equals(config.targetCustody) ||
          !account.collateralCustody.equals(config.collateralCustody) ||
          accountSide !== configuredSide
        ) {
          throw new Error('Flash ER returned a mismatched market account.');
        }

        return {
          side: configuredSide,
          openInterest: BigInt(account.collectivePosition.sizeUsd.toString()),
          openPositions: safeCount(account.collectivePosition.openPositions),
        };
      });
    const long = directions.filter((direction) => direction.side === 'long');
    const short = directions.filter((direction) => direction.side === 'short');

    if (long.length === 0 || short.length === 0) {
      throw new Error(`Flash does not expose both sides for ${market.symbol}.`);
    }

    return {
      symbol: market.symbol,
      poolName: market.poolName,
      venueRef: market.venueRef,
      longOpenInterest: usd(sum(long.map((entry) => entry.openInterest))),
      shortOpenInterest: usd(sum(short.map((entry) => entry.openInterest))),
      longOpenPositions: long.reduce(
        (total, entry) => total + entry.openPositions,
        0,
      ),
      shortOpenPositions: short.reduce(
        (total, entry) => total + entry.openPositions,
        0,
      ),
      slot,
    };
  });
}

async function fetchFlashPrices(
  origin: string,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, { readonly price: Amount; readonly publishedAtMs: number }>> {
  const value = await fetchJson(new URL('/prices', origin), signal);
  const root = record(value, 'Flash prices');
  const entries = Object.entries(root);

  if (entries.length === 0 || entries.length > MAX_MARKET_ENTRIES) {
    throw new Error('Flash returned an invalid price catalog.');
  }

  const prices = new Map<string, { price: Amount; publishedAtMs: number }>();

  for (const [asset, rawPrice] of entries) {
    const price = record(rawPrice, 'Flash price');
    const baseUnits = safeInteger(price.price, false);
    const exponent =
      typeof price.exponent === 'number' && Number.isSafeInteger(price.exponent)
        ? price.exponent
        : null;
    const timestampUs = safeInteger(price.timestampUs, false);

    if (
      !/^[A-Za-z0-9]{1,16}$/u.test(asset) ||
      baseUnits === null ||
      exponent === null ||
      timestampUs === null ||
      exponent > 0 ||
      exponent < -10
    ) {
      throw new Error('Flash returned invalid current price data.');
    }

    prices.set(asset.toUpperCase(), {
      price: amountFromBaseUnits(BigInt(baseUnits), decimals(-exponent)),
      publishedAtMs: Math.floor(timestampUs / 1_000),
    });
  }

  return prices;
}

async function fetchFlashChanges(
  origin: string,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, number>> {
  const values = array(await fetchJson(new URL('/token-prices/all', origin), signal));

  if (values.length === 0 || values.length > MAX_MARKET_ENTRIES) {
    throw new Error('Flash returned an invalid 24-hour price catalog.');
  }

  const changes = new Map<string, number>();

  for (const value of values) {
    const entry = record(value, 'Flash 24-hour price');
    const symbol = entry.symbol;
    const percent = entry.percentageChange24h;

    if (
      typeof symbol !== 'string' ||
      symbol.length === 0 ||
      typeof percent !== 'number' ||
      !Number.isFinite(percent) ||
      Math.abs(percent) > 100_000
    ) {
      throw new Error('Flash returned invalid 24-hour price data.');
    }

    changes.set(symbol.toUpperCase(), Math.round(percent * 100));
  }

  return changes;
}

async function fetchFlashStats(
  origin: string,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, Amount>> {
  const url = new URL('/market-stat/24hr', origin);
  url.searchParams.set('source', 'all');
  url.searchParams.set('program', 'flash');
  const values = array(await fetchJson(url, signal));

  if (values.length === 0 || values.length > MAX_MARKET_ENTRIES) {
    throw new Error('Flash returned an invalid market-stat catalog.');
  }

  const stats = new Map<string, Amount>();

  for (const value of values) {
    const entry = record(value, 'Flash market stat');
    const asset = entry.token;
    const volume = entry.volume24h;

    if (
      typeof asset !== 'string' ||
      !/^[A-Za-z0-9]{1,16}$/u.test(asset) ||
      typeof volume !== 'number' ||
      !Number.isFinite(volume) ||
      volume < 0 ||
      volume > Number.MAX_SAFE_INTEGER / 100
    ) {
      throw new Error('Flash returned invalid market stats.');
    }

    stats.set(
      asset.toUpperCase(),
      amountFromBaseUnits(BigInt(Math.round(volume * 100)), 2),
    );
  }

  return stats;
}

async function fetchJson(url: URL, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url.toString(), {
    headers: { accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Flash market data returned HTTP ${response.status}.`);
  }

  const body = await response.text();

  if (new TextEncoder().encode(body).byteLength > MAX_MARKET_DATA_BYTES) {
    throw new Error('Flash market data exceeded the response limit.');
  }

  return JSON.parse(body) as unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid object.`);
  }

  return value as Record<string, unknown>;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Flash market data returned an invalid array.');
  }

  return value;
}

function safeInteger(value: unknown, allowZero: boolean): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    (value > 0 || (allowZero && value === 0))
    ? value
    : null;
}

function decimals(value: number): 0 | 2 | 3 | 5 | 6 | 8 | 9 | 10 {
  if ([0, 2, 3, 5, 6, 8, 9, 10].includes(value)) {
    return value as 0 | 2 | 3 | 5 | 6 | 8 | 9 | 10;
  }

  throw new Error('Flash returned an unsupported price exponent.');
}

function isPriceStale(publishedAtMs: number, nowMs: number): boolean {
  const ageMs = nowMs - publishedAtMs;
  return ageMs > MAX_PRICE_AGE_MS || ageMs < -MAX_FUTURE_SKEW_MS;
}

function marketConfigs(
  pool: PoolConfig,
  market: MainnetMarket,
): readonly MarketConfig[] {
  const names = new Set([
    `${market.baseAsset} Long`,
    `${market.baseAsset} Short`,
  ]);
  const matches = pool.markets.filter((config) => names.has(config.marketNameUi));

  if (matches.length === 0) {
    throw new Error(`Flash does not configure ${market.symbol}.`);
  }

  return matches;
}

function chunks<T>(values: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function side(config: MarketConfig): 'long' | 'short' {
  if ('long' in config.side) return 'long';
  if ('short' in config.side) return 'short';
  throw new Error('Flash returned a market without a trading side.');
}

function safeCount(value: { toString(): string }): number {
  const count = BigInt(value.toString());

  if (count < 0n || count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Flash returned an invalid open-position count.');
  }

  return Number(count);
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function usd(baseUnits: bigint): Amount {
  return amountFromBaseUnits(baseUnits, 6);
}
