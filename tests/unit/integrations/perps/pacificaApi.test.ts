import { canonicalJson } from '@/integrations/perps/pacifica/pacificaApi';
import {
  parsePacificaBalanceActivity,
  parsePacificaTradeActivity,
} from '@/integrations/perps/pacifica/pacificaActivity';
import {
  formatPacificaRatePercent,
  parsePacificaPrices,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import { preparePacificaOrder } from '@/integrations/perps/pacifica/pacificaOrder';
import { MARKET_TIMEFRAMES } from '@/integrations/perps/pacifica/pacificaHistory';
import {
  orderBookSpreadPercent,
  parsePacificaFundingHistory,
  parsePacificaOrderBook,
  parsePacificaPublicTrades,
  totalBookLiquidity,
} from '@/integrations/perps/pacifica/pacificaPublicMarket';

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
}));

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

describe('Pacifica market order intent', () => {
  it('binds valid long TP/SL prices and the selected margin mode', async () => {
    const plan = await preparePacificaOrder({
      account: '11111111111111111111111111111111',
      action: 'open',
      apiOrigin: 'https://example.invalid',
      collateralBaseUnits: 100_000_000n,
      leverage: 5,
      marginMode: 'cross',
      market: {
        baseAsset: 'TEST', displayName: 'TEST', iconUrl: '', isolatedOnly: false,
        lotSize: '0.001', maxLeverage: 20, maxOrderSize: '100', minOrderSize: '0.001',
        symbol: 'TEST-PERP', tickSize: '0.1', venueRef: 'TEST',
      },
      orderPrice: '99',
      orderType: 'limit',
      portfolio: {
        accountEquity: '100', availableToSpend: '100', availableToWithdraw: '100',
        balance: '100', initialized: true, makerFee: '0.0002', orders: [], pendingBalance: '0',
        ordersCount: 0, positions: [], positionsCount: 0, stopOrdersCount: 0,
        takerFee: '0.0007', totalMarginUsed: '0', crossMmr: '0',
        fetchedAtMs: Date.now(), updatedAtMs: Date.now(),
      },
      side: 'long',
      snapshot: {
        change24hBps: 0, fundingRate: '0', nextFundingRate: '0',
        openInterest: { baseUnits: 0n, decimals: 10 },
        oraclePrice: { baseUnits: 1_000_000_000_000n, decimals: 10 },
        price: { baseUnits: 1_000_000_000_000n, decimals: 10 },
        pricePublishedAtMs: Date.now(), priceStale: false,
        venueRef: 'TEST', volume24h: { baseUnits: 0n, decimals: 10 },
      },
      stopLossPrice: '90',
      takeProfitPrice: '110',
      triggerPrice: undefined,
    });

    expect(plan.marginMode).toBe('cross');
    expect(plan.orderPrice).toBe('99');
    expect(plan.orderType).toBe('limit');
    expect(plan.takeProfit?.stopPrice).toBe('110');
    expect(plan.stopLoss?.stopPrice).toBe('90');
  });
});

describe('Pacifica public prices', () => {
  it('preserves the precision currently returned for 24 hour volume', () => {
    const [snapshot] = parsePacificaPrices([{
      funding: '0.0000125',
      mark: '0.8',
      next_funding: '0.0000125',
      open_interest: '120.12',
      oracle: '0.81',
      symbol: 'ASTER',
      timestamp: Date.now(),
      volume_24h: '2691.2649208',
      yesterday_price: '0.79',
    }]);

    expect(snapshot?.volume24h).toEqual({
      baseUnits: 26_912_649_208_000n,
      decimals: 10,
    });
    expect(formatPacificaRatePercent('0.0000125')).toBe('+0.0013%');
  });
});

describe('Pacifica public market detail data', () => {
  it('keeps book, trade, liquidation, and funding values exact', () => {
    const book = parsePacificaOrderBook({
      l: [
        [{ a: '2', n: 3, p: '100' }],
        [{ a: '1', n: 2, p: '101' }],
      ],
      li: 8,
      s: 'BTC',
      t: 1_765_006_315_306,
    });
    expect(totalBookLiquidity(book.bids).baseUnits).toBe(2_000_000_000_000n);
    expect(totalBookLiquidity(book.asks).baseUnits).toBe(1_010_000_000_000n);
    expect(orderBookSpreadPercent(book)).toBe('0.9950%');

    expect(parsePacificaPublicTrades([{
      amount: '0.001', cause: 'market_liquidation', created_at: 1_765_006_315_306,
      price: '65000.25', side: 'close_long', symbol: 'BTC',
    }], 'BTC')[0]).toMatchObject({ cause: 'market_liquidation', side: 'close_long' });

    expect(parsePacificaFundingHistory([{
      ask_impact_price: '65001', bid_impact_price: '64999', created_at: 1_765_006_315_306,
      funding_rate: '-0.0000125', next_funding_rate: '0.0000100', oracle_price: '65000',
    }])[0]?.fundingRateBaseUnits).toBe(-12_500_000n);
  });
});

describe('Pacifica candle intervals', () => {
  it('exposes every interval accepted by the mark-candle API', () => {
    expect(MARKET_TIMEFRAMES.map(({ id }) => id)).toEqual([
      '1m', '3m', '5m', '15m', '30m', '1h', '2h',
      '4h', '8h', '12h', '1d', '1w', '1M',
    ]);
  });
});

describe('Pacifica account activity', () => {
  it('keeps exact trade and balance values from the account history APIs', () => {
    expect(parsePacificaTradeActivity([{
      amount: '0.001',
      cause: 'normal',
      created_at: 1_765_006_315_306,
      fee: '0.026',
      history_id: 22,
      pnl: '1.250000',
      price: '65000.25',
      side: 'close_long',
      symbol: 'BTC',
    }])[0]).toMatchObject({ amount: '0.001', pnl: '1.250000', side: 'close_long' });

    expect(parsePacificaBalanceActivity([{
      amount: '100.000000',
      balance: '1200.000000',
      created_at: 1_716_200_000_000,
      event_type: 'deposit',
    }])[0]).toMatchObject({ amount: '100.000000', eventType: 'deposit' });
  });
});
