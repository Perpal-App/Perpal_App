import { availablePacificaReturnBaseUnits } from './pacificaWithdrawal';

describe('availablePacificaReturnBaseUnits', () => {
  it('keeps the venue fee and rejects amounts below the venue minimum', () => {
    expect(availablePacificaReturnBaseUnits(10_500_000n, 500_000n)).toBe(10_000_000n);
    expect(availablePacificaReturnBaseUnits(1_499_999n, 500_000n)).toBe(0n);
  });
});
