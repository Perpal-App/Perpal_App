import { canonicalJson } from '@/integrations/perps/pacifica/pacificaApi';

describe('Pacifica canonical signing payload', () => {
  it('sorts every object recursively without changing array order', () => {
    expect(canonicalJson({
      type: 'create_market_order',
      data: { symbol: 'BTC', amount: '0.01', take_profit: { stop_price: '70000', limit_price: '69900' } },
      expiry_window: 5_000,
      timestamp: 123,
    })).toBe(
      '{"data":{"amount":"0.01","symbol":"BTC","take_profit":{"limit_price":"69900","stop_price":"70000"}},"expiry_window":5000,"timestamp":123,"type":"create_market_order"}',
    );
  });
});
