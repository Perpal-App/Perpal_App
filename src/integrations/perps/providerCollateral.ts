import { MainnetSpotMarkets } from '@velocity-exchange/sdk/lib/browser/constants/spotMarkets';

import type { PerpsProviderId } from '@/config/appConfig';
import { flashPool } from '@/integrations/perps/flash/flashMarketData';

export type ProviderCollateral = {
  readonly symbol: 'USDC' | 'USDT';
  readonly mint: string;
  readonly decimals: 6;
};

export type ProviderCollateralOption = ProviderCollateral & {
  readonly provider: PerpsProviderId;
};

export function listProviderCollateralOptions(
  flashProgramId: string,
): readonly ProviderCollateralOption[] {
  return (['flash', 'velocity'] as const).map((provider) => ({
    provider,
    ...providerCollateral(provider, flashProgramId),
  }));
}

export function listTradingCollateralOptions(
  flashProgramId: string,
): readonly ProviderCollateral[] {
  const options = new Map<ProviderCollateral['symbol'], ProviderCollateral>();

  for (const { provider: _, ...collateral } of listProviderCollateralOptions(
    flashProgramId,
  )) {
    options.set(collateral.symbol, collateral);
  }

  return [...options.values()];
}

export function providerCollateral(
  provider: PerpsProviderId,
  flashProgramId: string,
): ProviderCollateral {
  if (provider === 'flash') {
    const token = flashPool(flashProgramId).tokens.find(
      (candidate) => candidate.symbol === 'USDC',
    );

    if (token === undefined || token.decimals !== 6) {
      throw new Error('Flash mainnet USDC collateral is unavailable.');
    }

    return { symbol: 'USDC', mint: token.mintKey.toBase58(), decimals: 6 };
  }

  const token = MainnetSpotMarkets.find(
    (candidate) => candidate.marketIndex === 0 && candidate.symbol === 'USDT',
  );

  if (token === undefined || token.precisionExp.toString() !== '6') {
    throw new Error('Velocity mainnet USDT collateral is unavailable.');
  }

  return { symbol: 'USDT', mint: token.mint.toBase58(), decimals: 6 };
}
