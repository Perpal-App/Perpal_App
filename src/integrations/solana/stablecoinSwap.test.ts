import {
  assertStablecoinSwapSolFunding,
  hasValidSwapRouteWeights,
  StablecoinSwapError,
} from '@/integrations/solana/stablecoinSwap';

describe('assertStablecoinSwapSolFunding', () => {
  it('allows exact funding and counts first-time token-account rent', () => {
    expect(() => assertStablecoinSwapSolFunding(5_000, 2_044_280, 2_039_280))
      .not.toThrow();
    expect(() => assertStablecoinSwapSolFunding(5_000, 2_044_279, 2_039_280))
      .toThrow(expect.objectContaining<Partial<StablecoinSwapError>>({
        code: 'insufficient_sol',
      }));
  });

  it('accepts sequential split routes without summing unrelated hop weights', () => {
    expect(hasValidSwapRouteWeights([
      { bps: 2_361 },
      { bps: 7_639 },
      { bps: 10_000 },
    ])).toBe(true);
    expect(hasValidSwapRouteWeights([{ bps: 10_001 }])).toBe(false);
  });
});
