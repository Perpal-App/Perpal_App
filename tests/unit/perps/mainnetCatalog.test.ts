import { listMainnetMarkets } from '@/integrations/perps/markets/mainnetCatalog';

describe('Flash mainnet catalog', () => {
  it('exposes only uniquely routable complete markets', () => {
    const markets = listMainnetMarkets();
    const references = new Set(markets.map((market) => market.venueRef));

    expect(markets.length).toBeGreaterThan(3);
    expect(references.size).toBe(markets.length);
    expect(markets.every((market) =>
      market.symbol === `${market.baseAsset}-PERP` &&
      market.venueRef === `${market.poolName}:${market.baseAsset}` &&
      market.maxLeverage > 0,
    )).toBe(true);
    expect(markets.find((market) => market.symbol === 'SOL-PERP')?.maxLeverage)
      .toBe(500);
    expect(markets.find((market) => market.symbol === 'ZEC-PERP')?.maxLeverage)
      .toBe(10);
  });
});
