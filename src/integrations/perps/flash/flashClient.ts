import type { Wallet } from '@flash_trade/flash-sdk-v2/node_modules/@coral-xyz/anchor';
import { AnchorProvider } from '@flash_trade/flash-sdk-v2/node_modules/@coral-xyz/anchor';
import { FlashPerpetualsClient } from '@flash_trade/flash-sdk-v2/dist/FlashPerpetualsClient';
import { Connection, PublicKey } from '@flash_trade/flash-sdk-v2/node_modules/@solana/web3.js';

export function createReadOnlyFlashClient(input: {
  readonly baseRpcUrl: string;
  readonly erRpcUrl: string;
  readonly owner: string;
  readonly programId: string;
}): FlashPerpetualsClient {
  const publicKey = new PublicKey(input.owner);
  const unavailable = async (): Promise<never> => {
    throw new Error('Flash signing is owned by the private-wallet adapter.');
  };
  const wallet = {
    publicKey,
    signTransaction: unavailable,
    signAllTransactions: unavailable,
  } as unknown as Wallet;
  const provider = new AnchorProvider(
    new Connection(input.baseRpcUrl, 'confirmed'),
    wallet,
    { commitment: 'confirmed' },
  );

  return new FlashPerpetualsClient(
    provider,
    undefined,
    new PublicKey(input.programId),
    { prioritizationFee: 5_000 },
    input.erRpcUrl,
  );
}
