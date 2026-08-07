import { PoolConfig } from '@flash_trade/flash-sdk-v2/dist/PoolConfig';
import poolConfigJson from '@flash_trade/flash-sdk-v2/dist/PoolConfig.json';

export type MainnetMarketSymbol = `${string}-PERP`;

export type MainnetMarket = {
  readonly symbol: MainnetMarketSymbol;
  readonly baseAsset: string;
  readonly poolName: string;
  readonly maxLeverage: number;
  readonly venueRef: string;
};

const ACTIVE_POOL_NAMES = poolConfigJson.pools
  .filter((pool) => pool.cluster === 'mainnet-beta' && !pool.isDeprecated)
  .map((pool) => pool.poolName);

let catalog: readonly MainnetMarket[] | null = null;

export function listFlashPoolNames(): readonly string[] {
  return ACTIVE_POOL_NAMES;
}

export function listMainnetMarkets(): readonly MainnetMarket[] {
  catalog ??= ACTIVE_POOL_NAMES.flatMap((poolName) =>
    marketsInPool(PoolConfig.fromIdsByName(poolName, 'mainnet-beta')),
  );
  return catalog;
}

function marketsInPool(pool: PoolConfig): readonly MainnetMarket[] {
  const assets = new Map<string, { long: number[]; short: number[] }>();

  for (const market of pool.markets) {
    const match = /^(.+) (Long|Short)$/u.exec(market.marketNameUi);
    if (match === null || match[1] === undefined || match[2] === undefined) {
      continue;
    }

    const directions = assets.get(match[1]) ?? { long: [], short: [] };
    directions[match[2] === 'Long' ? 'long' : 'short'].push(market.maxLev);
    assets.set(match[1], directions);
  }

  return [...assets.entries()].flatMap(([baseAsset, directions]) => {
    if (directions.long.length === 0 || directions.short.length === 0) {
      return [];
    }

    return [{
      symbol: `${baseAsset}-PERP` as const,
      baseAsset,
      poolName: pool.poolName,
      maxLeverage: Math.max(...directions.long, ...directions.short),
      venueRef: `${pool.poolName}:${baseAsset}`,
    }];
  });
}
