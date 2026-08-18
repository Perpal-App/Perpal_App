import {
  parsePythHistory,
  parsePythResponse,
  parsePythStreamFrame,
} from '../../../workers/gateway/src/marketData';

const FEEDS = {
  BTC: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  SOL: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
} as const;

describe('public market-data trust boundary', () => {
  it('matches every configured feed and preserves exact values', () => {
    const parsed = parsePythResponse(
      {
        parsed: [
          update(FEEDS.SOL, '7373703007'),
          update(FEEDS.BTC, '11800000000000'),
          update(FEEDS.ETH, '400000000000'),
        ],
      },
      FEEDS,
    );

    expect(parsed.map((market) => market.symbol)).toEqual([
      'BTC-PERP',
      'ETH-PERP',
      'SOL-PERP',
    ]);
    expect(parsed[2]).toMatchObject({
      price: '7373703007',
      confidence: '731526',
      exponent: -8,
      publishedAtMs: 1_775_520_333_000,
    });
    expect(() =>
      parsePythResponse({ parsed: [update(FEEDS.SOL, '1')] }, FEEDS),
    ).toThrow();

    const streamed = parsePythStreamFrame(
      `data: ${JSON.stringify({
        parsed: [
          update(FEEDS.SOL, '7373703007'),
          update(FEEDS.BTC, '11800000000000'),
          update(FEEDS.ETH, '400000000000'),
        ],
      })}`,
      FEEDS,
    );

    expect(streamed?.markets[0]?.symbol).toBe('BTC-PERP');
  });

  it('aggregates real source candles into the requested interval', () => {
    expect(parsePythHistory({
      s: 'ok',
      t: [180, 240, 300, 360],
      o: [10, 11, 12, 13],
      h: [12, 13, 14, 15],
      l: [9, 10, 11, 12],
      c: [11, 12, 13, 14],
    }, 180)).toEqual([
      { timeMs: 180_000, open: 10, high: 14, low: 9, close: 13 },
      { timeMs: 360_000, open: 13, high: 15, low: 12, close: 14 },
    ]);
  });
});

function update(id: string, price: string) {
  return {
    id,
    price: {
      price,
      conf: '731526',
      expo: -8,
      publish_time: 1_775_520_333,
    },
  };
}
