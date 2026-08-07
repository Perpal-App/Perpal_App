import { PoolConfig } from '@flash_trade/flash-sdk-v2/dist/PoolConfig';
import poolConfigJson from '@flash_trade/flash-sdk-v2/dist/PoolConfig.json';

export type MainnetMarketSymbol = `${string}-PERP`;
export type MainnetMarketCategory =
  | 'crypto'
  | 'forex'
  | 'commodities'
  | 'metals'
  | 'equities'
  | 'other';

export type MainnetMarket = {
  readonly symbol: MainnetMarketSymbol;
  readonly baseAsset: string;
  readonly displayName: string;
  readonly category: MainnetMarketCategory;
  readonly oracleSymbol: string;
  readonly poolName: string;
  readonly maxLeverage: number;
  readonly venueRef: string;
  /**
   * Venue-published icon for the asset, carried in the pool config next to the
   * rest of the market's metadata. Empty when the venue lists none, which the
   * UI renders as a monogram rather than substituting another image source.
   */
  readonly iconUrl: string;
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
    directions[match[2] === 'Long' ? 'long' : 'short'].push(
      market.degenMaxLev,
    );
    assets.set(match[1], directions);
  }

  return [...assets.entries()].flatMap(([baseAsset, directions]) => {
    if (directions.long.length === 0 || directions.short.length === 0) {
      return [];
    }

    const token = pool.tokens.find((candidate) => candidate.symbol === baseAsset);

    if (token === undefined || token.pythTicker.length === 0) {
      return [];
    }

    return [{
      symbol: `${baseAsset}-PERP` as const,
      baseAsset,
      displayName: token.fullName.trim() || baseAsset,
      category: marketCategory(token.category[0]),
      oracleSymbol: token.pythTicker,
      poolName: pool.poolName,
      maxLeverage: Math.max(...directions.long, ...directions.short),
      venueRef: `${pool.poolName}:${baseAsset}`,
      iconUrl: token.iconUrl.trim(),
    }];
  });
}

function marketCategory(value: string | undefined): MainnetMarketCategory {
  switch (value?.toLowerCase()) {
    case 'crypto':
    case 'forex':
    case 'commodities':
    case 'metals':
      return value.toLowerCase() as MainnetMarketCategory;
    case 'stocks':
    case 'equities':
      return 'equities';
    default:
      return 'other';
  }
}
