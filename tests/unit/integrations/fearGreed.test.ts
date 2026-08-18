import { parseFearGreedIndex } from '@/integrations/market-data/fearGreed';

it('validates the CoinMarketCap Fear and Greed response', () => {
  expect(parseFearGreedIndex({
    data: {
      value: 40,
      value_classification: 'Neutral',
      update_time: '2026-08-08T13:53:10.024Z',
    },
  })).toEqual({
    value: 40,
    classification: 'Neutral',
    updatedAtMs: Date.parse('2026-08-08T13:53:10.024Z'),
  });
  expect(() => parseFearGreedIndex({
    data: {
      value: 101,
      value_classification: 'Greed',
      update_time: '2026-08-08T13:53:10.024Z',
    },
  })).toThrow('invalid Fear and Greed data');
});
