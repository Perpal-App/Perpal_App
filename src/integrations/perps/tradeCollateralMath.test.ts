import { creditedDepositAmount } from '@/integrations/perps/tradeCollateralMath';

describe('creditedDepositAmount', () => {
  it('separates a small trade shortfall from Pacifica\'s credited deposit minimum', () => {
    expect(creditedDepositAmount(100_000n, 10_000_000n)).toBe(10_000_000n);
    expect(creditedDepositAmount(12_000_000n, 10_000_000n)).toBe(12_000_000n);
  });
});
