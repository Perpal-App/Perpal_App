import { Buffer } from 'buffer';

import { decodeFlashMarket } from '@/integrations/perps/flash/flashAccountCoder';

const LIVE_MARKET_ACCOUNT =
  '277VNwDjxpr3hwN0bkqBxs1Rdjf1kyhSf3F4Wrmw/fZ4MjpiziyaV+lNCtQy5LhXcmj9aTFYmSRGZZJ8ukxV0ptIYwM9lHhl6U0K1DLkuFdyaP1pMViZJEZlkny6TFXSm0hjAz2UeGUBAcQJAAAAAAAAAQEBARiK7hIBAAAALQAAAAAAAAAAAAAAAAAAAOcFiM48BgAA+P///yZYZyIAAAAAdszZKlwAAAACImIQAAAAAAAAAAAAAAAAAAAAAAAAAACcy8uEDgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgICAIAAAAAAAAAAgAAAAAAAAD7AAAAAAAAAAAAAA==';

describe('decodeFlashMarket', () => {
  it('decodes the pinned SDK account layout used by the ER read path', () => {
    const market = decodeFlashMarket(Buffer.from(LIVE_MARKET_ACCOUNT, 'base64'));

    expect(market.side).toEqual({ long: {} });
    expect(market.collectivePosition.openPositions.toString()).toBe('45');
    expect(market.collectivePosition.sizeUsd.toString()).toBe('395855907958');
  });
});
