export type ProviderCollateral = {
  readonly symbol: 'USDC' | 'USDT';
  readonly mint: string;
  readonly decimals: 6;
};

export function listTradingCollateralOptions(
  usdcMint: string,
  usdtMint: string,
): readonly ProviderCollateral[] {
  return [pacificaCollateral(usdcMint), {
    symbol: 'USDT',
    mint: usdtMint,
    decimals: 6,
  }];
}

export function pacificaCollateral(usdcMint: string): ProviderCollateral {
  return { symbol: 'USDC', mint: usdcMint, decimals: 6 };
}
