import { valueTokenHoldingsUsd } from '@/domain/money/tokenValuation';

describe('valueTokenHoldingsUsd', () => {
  it('values native and SPL holdings while counting an omitted price', () => {
    const result = valueTokenHoldingsUsd(
      [
        { mint: 'SOL', baseUnits: 7_000_000n, decimals: 9 },
        { mint: 'USDC', baseUnits: 50_000n, decimals: 6 },
        { mint: 'UNKNOWN', baseUnits: 1n, decimals: 0 },
      ],
      new Map([
        ['SOL', '100'],
        ['USDC', '1'],
      ]),
    );

    expect(result).toEqual({ usdBaseUnits: 750_000n, unpricedAssetCount: 1 });
  });
});
