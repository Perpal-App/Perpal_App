import { PublicKey } from '@solana/web3.js';
import { BN } from '@velocity-exchange/sdk/lib/browser/isomorphic/anchor';
import type {
  EventType,
  WrappedEvent,
} from '@velocity-exchange/sdk/lib/browser/events/types';

import { parseVelocityTradeEvents } from './velocityActivity';

describe('Velocity trade history', () => {
  it('keeps only this account and identifies a closing fill', () => {
    const user = new PublicKey(new Uint8Array(32).fill(1));
    const other = new PublicKey(new Uint8Array(32).fill(2));
    const event = {
      eventType: 'OrderActionRecord',
      action: { fill: {} },
      marketType: { perp: {} },
      marketIndex: 0,
      taker: user,
      maker: other,
      takerOrderDirection: { short: {} },
      makerOrderDirection: { long: {} },
      takerExistingBaseAssetAmount: bn('1000000000'),
      makerExistingBaseAssetAmount: bn('0'),
      baseAssetAmountFilled: bn('1000000000'),
      quoteAssetAmountFilled: bn('80000000'),
      takerFee: bn('7200'),
      makerFee: bn('-1600'),
      ts: bn('1700000000'),
      slot: 42,
      txSigIndex: 3,
    } as unknown as WrappedEvent<EventType>;

    expect(parseVelocityTradeEvents([event], user)).toEqual([
      expect.objectContaining({
        amountBaseUnits: 1_000_000_000n,
        effect: 'closed',
        feeBaseUnits: 7_200n,
        priceBaseUnits: 80_000_000n,
        role: 'taker',
        side: 'short',
      }),
    ]);
    expect(parseVelocityTradeEvents([event], new PublicKey(new Uint8Array(32).fill(3))))
      .toEqual([]);
  });
});

function bn(value: string): BN {
  const Constructor = BN as unknown as new (input: string) => BN;
  return new Constructor(value);
}
