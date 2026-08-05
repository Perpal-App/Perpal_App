import { parsePublicMarketPrices } from '@/integrations/perps/markets/publicMarketData';

describe('public mainnet market prices', () => {
  it('normalizes exact prices and applies the freshness gate', () => {
    const markets = parsePublicMarketPrices(
      {
        network: 'mainnet',
        source: 'Pyth Hermes',
        markets: [
          market('BTC-PERP', '11800000000000'),
          market('ETH-PERP', '400000000000'),
          market('SOL-PERP', '7373703007'),
        ],
      },
      1_775_520_348_000,
    );

    expect(markets[2]).toMatchObject({
      symbol: 'SOL-PERP',
      price: { baseUnits: 7_373_703_007n, decimals: 8 },
      stale: false,
    });
  });
});

function market(symbol: string, price: string) {
  return {
    symbol,
    price,
    confidence: '731526',
    exponent: -8,
    publishedAtMs: 1_775_520_333_000,
  };
}
