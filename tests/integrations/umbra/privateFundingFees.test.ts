import { estimateUmbraCreateFee } from '@/integrations/umbra/privateFundingFees';

describe('estimateUmbraCreateFee', () => {
  it('uses the fee schedule pinned by the installed Umbra SDK', () => {
    expect(estimateUmbraCreateFee(50_000n)).toBe(173n);
    expect(estimateUmbraCreateFee(7_000_000n)).toBe(24_353n);
    expect(() => estimateUmbraCreateFee(-1n)).toThrow(RangeError);
  });
});
