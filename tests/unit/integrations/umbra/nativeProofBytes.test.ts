import { convertNativeProofToBytes } from '@/integrations/umbra/nativeProofBytes';

describe('convertNativeProofToBytes', () => {
  it('emits the Solana verifier layout and rejects invalid coordinates', () => {
    const proof = {
      a: { x: '1', y: '2' },
      b: { x: ['3', '5'], y: ['4', '6'] },
      c: { x: '7', y: '8' },
    };
    const result = convertNativeProofToBytes(proof);

    expect(result.proofA).toHaveLength(64);
    expect(result.proofB).toHaveLength(128);
    expect(result.proofC).toHaveLength(64);
    expect(result.proofA[31]).toBe(1);
    expect(result.proofA[63]).toBe(2);
    expect([31, 63, 95, 127].map((index) => result.proofB[index])).toEqual([
      5, 3, 6, 4,
    ]);
    expect(() =>
      convertNativeProofToBytes({ ...proof, a: { x: '-1', y: '2' } }),
    ).toThrow('invalid a.x coordinate');
  });
});
