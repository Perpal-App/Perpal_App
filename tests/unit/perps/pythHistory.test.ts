import { parsePythMarketHistory } from '@/integrations/perps/markets/pythHistory';

describe('Pyth market history', () => {
  it('accepts ordered OHLC candles and rejects inconsistent series', () => {
    expect(parsePythMarketHistory({
      s: 'ok',
      t: [1_700_000_000, 1_700_000_300],
      o: [100, 102],
      h: [103, 104],
      l: [99, 101],
      c: [102, 103],
    })).toHaveLength(2);

    expect(() => parsePythMarketHistory({
      s: 'ok',
      t: [1_700_000_000],
      o: [100],
      h: [],
      l: [99],
      c: [102],
    })).toThrow('inconsistent candles');
  });
});
