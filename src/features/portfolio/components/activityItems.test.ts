import { mergeActivity } from './activityItems';

describe('mergeActivity', () => {
  it('keeps confirmed local trades visible while venue history catches up', () => {
    const items = mergeActivity(null, [{
      createdAtMs: 1,
      correlationKeys: [],
      id: 'trade-1',
      kind: 'trade',
      message: 'Long SOL order confirmed.',
      outcome: 'success',
      readAtMs: null,
      status: 'confirmed',
      title: 'Order confirmed',
      version: 2,
    }]);

    expect(items).toEqual([expect.objectContaining({ kind: 'trade', title: 'Order confirmed' })]);
  });

  it('keeps a trade balance event when detailed trade history is unavailable', () => {
    const items = mergeActivity({
      balances: [{
        amount: '-0.01',
        balance: '9.99',
        createdAtMs: 10,
        eventType: 'trade',
      }],
      incomplete: true,
      orders: [],
      trades: [],
      truncated: false,
    }, []);

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'trade',
        title: 'Trade balance updated',
        value: '-$0.01',
      }),
    ]);
  });

  it('does not duplicate a balance event represented by a detailed trade', () => {
    const items = mergeActivity({
      balances: [{
        amount: '-0.01',
        balance: '9.99',
        createdAtMs: 10,
        eventType: 'trade',
      }],
      incomplete: false,
      orders: [],
      trades: [{
        amount: '0.1',
        cause: 'normal',
        clientOrderId: 'client-1',
        createdAtMs: 10,
        fee: '0.01',
        historyId: 1,
        orderId: 2,
        pnl: '0',
        price: '100',
        side: 'open_long',
        symbol: 'SOL',
      }],
      truncated: false,
    }, []);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(expect.objectContaining({ id: 'trade:1' }));
  });

  it('shows a cancelled order without claiming it was an executed trade', () => {
    const items = mergeActivity({
      balances: [],
      incomplete: false,
      orders: [{
        amount: '1',
        averageFilledPrice: '0',
        clientOrderId: 'client-2',
        createdAtMs: 10,
        filledAmount: '0',
        initialPrice: '100',
        orderId: 2,
        orderStatus: 'cancelled',
        orderType: 'limit',
        reason: 'cancel',
        reduceOnly: false,
        side: 'bid',
        symbol: 'SOL',
        updatedAtMs: 20,
      }],
      trades: [],
      truncated: false,
    }, []);

    expect(items).toEqual([expect.objectContaining({
      id: 'order:2:20',
      kind: 'trade',
      title: 'Buy SOL order cancelled',
    })]);
  });
});
