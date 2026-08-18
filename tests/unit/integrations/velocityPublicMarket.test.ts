import {
  parseVelocityOrderBook,
  parseVelocityPublicMarketMessage,
} from '@/integrations/perps/velocity/velocityPublicMarket';

describe('Velocity public market parsing', () => {
  it('keeps raw book precision and computes exact USD notionals', () => {
    const book = parseVelocityOrderBook({
      asks: [{ price: '77268000', size: '1000000000', sources: { vamm: '1000000000' } }],
      bids: [{ price: '76940000', size: '2000000000', sources: { dlob: '2000000000' } }],
      marketIndex: 0,
      marketName: 'SOL-PERP',
      markPrice: '77104000',
      oracleData: { price: '77179593' },
      slot: 440109314,
      ts: 1787077607379,
    }, 'SOL-PERP', 0);

    expect(book.bids[0]?.notional.baseUnits).toBe(153_880_000n);
    expect(book.asks[0]?.price.baseUnits).toBe(77_268_000n);
  });

  it('decodes the double-encoded trade envelope without retaining its signature', () => {
    const message = parseVelocityPublicMarketMessage({
      channel: 'trades_perp_0',
      data: JSON.stringify({
        action: 'fill',
        actionExplanation: 'orderFilledWithAmm',
        baseAssetAmountFilled: 2,
        fillRecordId: 9,
        marketIndex: 0,
        marketType: 'perp',
        quoteAssetAmountFilled: 154.208,
        slot: 440109400,
        takerOrderDirection: 'long',
        ts: 1787077610,
        txSig: 'not-retained',
      }),
    }, 'SOL-PERP', 0);

    expect(message?.channel).toBe('trades');
    if (message?.channel === 'trades') {
      expect(message.trades[0]?.price.baseUnits).toBe(77_104_000n);
      expect(message.trades[0]?.cause).toBe('order_filled_with_amm');
      expect(message.trades[0]).not.toHaveProperty('txSig');
    }
  });
});
