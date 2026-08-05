import { PoolConfig, type MarketConfig } from '@flash_trade/flash-sdk-v2/dist/PoolConfig';

import { amountFromBaseUnits, type Amount } from '@/domain/money/amount';
import { fetchPublicProgramAccounts } from '@/integrations/api/publicSolanaRpc';
import type { MainnetMarket } from '@/integrations/perps/markets/mainnetCatalog';
import { decodeFlashMarket } from '@/integrations/perps/flash/flashAccountCoder';

export type FlashMarketSnapshot = {
  readonly symbol: MainnetMarket['symbol'];
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
  const pool = flashPool(programId);
  const configs = markets.flatMap((market) => marketConfigs(pool, market));
  const response = await fetchPublicProgramAccounts(
    erRpcUrl,
    configs.map((config) => config.marketAccount.toBase58()),
    programId,
    signal,
  );

  return markets.map((market) => {
    const directions = configs
      .map((config, index) => ({ config, data: response.accounts[index] }))
      .filter(({ config }) => config.marketNameUi.startsWith(`${market.baseAsset} `))
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
      slot: response.slot,
    };
  });
}

export function flashPool(programId: string): PoolConfig {
  const pool = PoolConfig.fromIdsByName('Crypto.1', 'mainnet-beta');

  if (pool.programId.toBase58() !== programId) {
    throw new Error('Configured Flash program does not match the SDK catalog.');
  }

  return pool;
}

function marketConfigs(
  pool: PoolConfig,
  market: MainnetMarket,
): readonly MarketConfig[] {
  const matches = pool.markets.filter((config) =>
    config.marketNameUi.startsWith(`${market.baseAsset} `),
  );

  if (matches.length === 0) {
    throw new Error(`Flash does not configure ${market.symbol}.`);
  }

  return matches;
}

function side(config: MarketConfig): 'long' | 'short' {
  if ('long' in config.side) {
    return 'long';
  }

  if ('short' in config.side) {
    return 'short';
  }

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
