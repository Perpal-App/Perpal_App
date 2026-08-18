import {
  collateralShortfall,
  fundingRequiredSol,
  scaledInputForMinimumOutput,
} from '../../../src/integrations/perps/tradeCollateralMath';

it('trade collateral math never underfunds a provider step', () => {
  expect(collateralShortfall(50_000n, 20_000n)).toBe(30_000n);
  expect(collateralShortfall(50_000n, 50_000n)).toBe(0n);
  expect(fundingRequiredSol(5_000n, 2_039_280n)).toBe(2_044_280n);
  expect(scaledInputForMinimumOutput(
    1_000_000n,
    1_000_000n,
    995_000n,
  )).toBe(1_005_026n);
});
