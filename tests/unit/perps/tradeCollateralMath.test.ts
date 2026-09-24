import {
  collateralShortfall,
  creditedDepositAmount,
  fundingRequiredSol,
} from '../../../src/integrations/perps/tradeCollateralMath';

it('trade collateral math never underfunds a provider step', () => {
  expect(collateralShortfall(50_000n, 20_000n)).toBe(30_000n);
  expect(collateralShortfall(50_000n, 50_000n)).toBe(0n);
  expect(collateralShortfall(20_000n, 50_000n)).toBe(0n);
  expect(fundingRequiredSol(5_000n, 2_039_280n)).toBe(2_044_280n);
});

it('credited deposit amounts refuse to be zero or negative', () => {
  // A deposit of nothing is a signed transaction that credits nothing and still costs a fee.
  expect(() => creditedDepositAmount(0n, 10_000_000n)).toThrow(
    'Pacifica deposit amounts must be positive.',
  );
  expect(() => creditedDepositAmount(-1n, 10_000_000n)).toThrow(
    'Pacifica deposit amounts must be positive.',
  );
  expect(() => creditedDepositAmount(5_000_000n, 0n)).toThrow(
    'Pacifica deposit amounts must be positive.',
  );
});
