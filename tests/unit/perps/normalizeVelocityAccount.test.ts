import { normalizeVelocityAccount } from '@/integrations/perps/velocity/normalizeVelocityAccount';

class PreservedValue {
  readonly value = 'unchanged';
}

describe('normalizeVelocityAccount', () => {
  it('normalizes SDK field names while preserving decoded class values', () => {
    const preserved = new PreservedValue();
    const normalized = normalizeVelocityAccount<{
      readonly marketStats: {
        readonly volume24H: PreservedValue;
        readonly lastMarkPriceTwap5Min: number;
        readonly last24HAvgFundingRate: number;
      };
    }>(
      {
        market_stats: {
          volume24h: preserved,
          last_mark_price_twap_5min: 1,
          last24h_avg_funding_rate: 2,
        },
      },
    );

    expect(normalized).toEqual({
      marketStats: {
        volume24H: preserved,
        lastMarkPriceTwap5Min: 1,
        last24HAvgFundingRate: 2,
      },
    });
    expect(normalized.marketStats.volume24H).toBe(preserved);
  });
});
