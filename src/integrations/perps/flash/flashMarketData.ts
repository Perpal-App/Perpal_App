import { PoolConfig, type MarketConfig } from '@flash_trade/flash-sdk-v2/dist/PoolConfig';

import { amountFromBaseUnits, type Amount } from '@/domain/money/amount';
import { fetchPublicProgramAccounts } from '@/integrations/api/publicSolanaRpc';
import { decodeFlashMarket } from '@/integrations/perps/flash/flashAccountCoder';
import {
  listFlashPoolNames,
  type MainnetMarket,
} from '@/integrations/perps/markets/mainnetCatalog';

const MAX_ACCOUNTS_PER_REQUEST = 24;

export type FlashMarketSnapshot = {
  readonly symbol: MainnetMarket['symbol'];
  readonly poolName: string;
  readonly venueRef: string;
  readonly longOpenInterest: Amount;
  readonly shortOpenInterest: Amount;
  readonly longOpenPositions: number;
  readonly shortOpenPositions: number;
  readonly slot: number;
};

export async function fetchFlashMarketSnapshots(
  erRpcUrl: string,
  programId: string,
  markets: readonly MainnetMarket[],
  signal: AbortSignal,
): Promise<readonly FlashMarketSnapshot[]> {
  const byPool = new Map<string, MainnetMarket[]>();

  for (const market of markets) {
    const group = byPool.get(market.poolName) ?? [];
    group.push(market);
    byPool.set(market.poolName, group);
  }

  return (await Promise.all(
    [...byPool.entries()].map(([poolName, poolMarkets]) =>
      fetchPoolSnapshots(
        erRpcUrl,
        flashPool(programId, poolName),
        poolMarkets,
        signal,
      ),
    ),
  )).flat();
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
): Promise<readonly FlashMarketSnapshot[]> {
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
