import {
  isVelocityOracleStale,
  normalizeVelocityOraclePrice,
} from './velocityMarketData';

describe('Velocity market decoding', () => {
  it('normalizes Pyth Lazer prices and applies the protocol stale-slot limit', () => {
    expect(normalizeVelocityOraclePrice(6_473_030_000_000n, -8)).toBe(64_730_300_000n);
    expect(isVelocityOracleStale(1_010, 1_000n, 10n)).toBe(false);
    expect(isVelocityOracleStale(1_011, 1_000n, 10n)).toBe(true);
  });
});
