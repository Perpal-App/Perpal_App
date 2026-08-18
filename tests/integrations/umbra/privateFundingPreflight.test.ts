import { assertPrivateFundingPreflight } from '@/integrations/umbra/privateFundingPreflight';

describe('assertPrivateFundingPreflight', () => {
  it('rejects the exact underfunded route before proving or signing', () => {
    expect(() => assertPrivateFundingPreflight({
      availableCollateralBaseUnits: 50_008n,
      availableSolLamports: 12_271_468n,
      estimatedNetworkFeeLamports: 25_000n,
      missingCollateralBaseUnits: 0n,
      missingSolLamports: 1_592_172n,
      requiredCollateralBaseUnits: 50_000n,
      requiredSolLamports: 13_863_640n,
      temporaryRentLamports: 6_848_640n,
    })).toThrow('more SOL');
  });
});
