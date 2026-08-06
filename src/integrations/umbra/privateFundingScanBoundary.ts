import type { IUmbraClient } from '@umbra-privacy/sdk/client';

import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';

export async function seedScanBoundary(
  client: IUmbraClient,
  boundary: readonly string[],
): Promise<void> {
  if (client.utxoDataStore === undefined) {
    throw new PrivateFundingError(
      'Umbra scan-progress storage is unavailable.',
      'indexer_unavailable',
    );
  }

  for (const entry of boundary) {
    const match = /^(\d+):(\d+)$/u.exec(entry);
    if (match === null) {
      throw new PrivateFundingError(
        'Stored Umbra scan boundary is invalid.',
        'recovery_state_invalid',
      );
    }

    const treeIndex = BigInt(match[1]!);
    const numLeaves = BigInt(match[2]!);
    if (numLeaves === 0n) continue;

    await client.utxoDataStore.addScannedRange(
      client.network,
      client.signer.address,
      treeIndex as never,
      { start: 0n as never, end: (numLeaves - 1n) as never },
    );
  }
}
