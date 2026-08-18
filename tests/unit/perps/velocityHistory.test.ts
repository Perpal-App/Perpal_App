import { parseVelocityCandles } from '../../../src/integrations/perps/velocity/velocityHistory';

describe('Velocity Pyth history parser', () => {
  it('accepts the Worker candle schema and rejects unordered data', () => {
    const candles = parseVelocityCandles([
      { timeMs: 1_000, open: 10, high: 12, low: 9, close: 11 },
      { timeMs: 2_000, open: 11, high: 13, low: 10, close: 12 },
    ]);

    expect(candles).toHaveLength(2);
    expect(candles[1]?.close).toBe(12);
    expect(() => parseVelocityCandles([
      { timeMs: 2_000, open: 10, high: 12, low: 9, close: 11 },
      { timeMs: 1_000, open: 11, high: 13, low: 10, close: 12 },
    ])).toThrow('unordered');
  });
});
