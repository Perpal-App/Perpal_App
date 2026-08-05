import { PoolConfig } from '@flash_trade/flash-sdk-v2/dist/PoolConfig';
import { MainnetPerpMarkets } from '@velocity-exchange/sdk/lib/browser/constants/perpMarkets';

import type { PerpsProviderId } from '@/config/appConfig';

const CORE_ASSETS = ['BTC', 'ETH', 'SOL'] as const;
type CoreAsset = (typeof CORE_ASSETS)[number];

export type MainnetMarket = {
  readonly symbol: `${CoreAsset}-PERP`;
  readonly baseAsset: CoreAsset;
  readonly provider: PerpsProviderId;
  readonly providerLabel: 'Flash Trade v2' | 'Velocity';
  readonly maxLeverage: number | null;
  readonly venueRef: string;
};

export function listMainnetMarkets(
  provider: PerpsProviderId,
): readonly MainnetMarket[] {
  return provider === 'flash' ? listFlashMarkets() : listVelocityMarkets();
}

function listFlashMarkets(): readonly MainnetMarket[] {
  const pool = PoolConfig.fromIdsByName('Crypto.1', 'mainnet-beta');

  return CORE_ASSETS.map((asset) => {
    const matches = pool.markets.filter((market) =>
      market.marketNameUi.startsWith(`${asset} `),
    );

    if (matches.length === 0) {
      throw new Error(`Flash Trade v2 does not configure ${asset}-PERP.`);
    }

    return {
      symbol: `${asset}-PERP`,
      baseAsset: asset,
      provider: 'flash',
      providerLabel: 'Flash Trade v2',
      maxLeverage: Math.max(...matches.map((market) => market.maxLev)),
      venueRef: `Crypto.1:${asset}`,
    };
  });
}

function listVelocityMarkets(): readonly MainnetMarket[] {
  return CORE_ASSETS.map((asset) => {
    const symbol = `${asset}-PERP` as const;
    const market = MainnetPerpMarkets.find((entry) => entry.symbol === symbol);

    if (market === undefined) {
      throw new Error(`Velocity does not configure ${symbol} on mainnet.`);
    }

    return {
      symbol,
      baseAsset: asset,
      provider: 'velocity',
      providerLabel: 'Velocity',
      maxLeverage: null,
      venueRef: market.marketIndex.toString(),
    };
  });
}
