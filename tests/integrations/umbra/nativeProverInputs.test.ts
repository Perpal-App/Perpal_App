import { serializeUmbraCircuitInputs } from '@/integrations/umbra/nativeProverInputs';

describe('Umbra native prover inputs', () => {
  it('serializes every Circom signal as a flat string array', () => {
    expect(JSON.parse(serializeUmbraCircuitInputs({
      bytes: new Uint8Array([1, 2]),
      nested: [[3n], [4n, 5n]],
      scalar: 6n,
    }))).toEqual({
      bytes: ['1', '2'],
      nested: ['3', '4', '5'],
      scalar: ['6'],
    });
  });
});
