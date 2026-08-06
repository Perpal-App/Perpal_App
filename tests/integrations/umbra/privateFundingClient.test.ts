import type { IUmbraClient } from '@umbra-privacy/sdk/client';

import { seedScanBoundary } from '@/integrations/umbra/privateFundingScanBoundary';

describe('seedScanBoundary', () => {
  it('marks only leaves that existed before the funding operation', async () => {
    const addScannedRange = jest.fn().mockResolvedValue(undefined);
    const client = {
      network: 'mainnet',
      signer: { address: 'wallet' },
      utxoDataStore: { addScannedRange },
    } as unknown as IUmbraClient;

    await seedScanBoundary(client, ['0:3', '1:0']);

    expect(addScannedRange).toHaveBeenCalledTimes(1);
    expect(addScannedRange).toHaveBeenCalledWith(
      'mainnet',
      'wallet',
      0n,
      { start: 0n, end: 2n },
    );
  });
});
