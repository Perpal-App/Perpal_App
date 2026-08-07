import { flashPool } from '@/integrations/perps/flash/flashMarketData';

export type ProviderCollateral = {
  readonly symbol: 'USDC' | 'USDT';
  readonly mint: string;
  readonly decimals: 6;
};

export function listTradingCollateralOptions(
  flashProgramId: string,
  usdtMint: string,
): readonly ProviderCollateral[] {
  return [flashCollateral(flashProgramId), {
    symbol: 'USDT',
    mint: usdtMint,
    decimals: 6,
  }];
}

export function flashCollateral(flashProgramId: string): ProviderCollateral {
  const token = flashPool(flashProgramId).tokens.find(
    (candidate) => candidate.symbol === 'USDC',
  );

  if (token === undefined || token.decimals !== 6) {
    throw new Error('Flash mainnet USDC collateral is unavailable.');
  }

  return { symbol: 'USDC', mint: token.mintKey.toBase58(), decimals: 6 };
}
