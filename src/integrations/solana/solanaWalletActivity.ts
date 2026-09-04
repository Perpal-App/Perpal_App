import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import { privateIdentifier } from '@/storage/privateIdentifier';

export type SolanaWalletActivity = {
  readonly correlationKey: string;
  readonly createdAtMs: number;
  readonly id: string;
  readonly outcome: 'error' | 'success';
  readonly wallet: 'private' | 'public' | 'transfer';
};

type SignatureEntry = {
  readonly blockTime: number | null;
  readonly confirmationStatus?: string | null;
  readonly err: unknown;
  readonly signature: string;
};

const HISTORY_LIMIT = 40;

export async function fetchSolanaWalletActivity(input: {
  readonly privateAddress: string;
  readonly publicAddress: string;
  readonly rpcUrl: string;
  readonly signal?: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<readonly SolanaWalletActivity[]> {
  const addresses = uniqueAddresses(input.publicAddress, input.privateAddress);
  const results = await Promise.allSettled(addresses.map(({ address }) =>
    signedSolanaRpc<readonly SignatureEntry[]>({
      method: 'getSignaturesForAddress',
      params: [address, { commitment: 'confirmed', limit: HISTORY_LIMIT }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ));

  const fulfilled = results.flatMap((result, index) => (
    result.status === 'fulfilled'
      ? [{ entries: result.value, wallet: addresses[index]?.wallet ?? 'private' as const }]
      : []
  ));
  if (fulfilled.length === 0) {
    const failed = results.find((result) => result.status === 'rejected');
    throw failed?.status === 'rejected' ? failed.reason : new Error('Wallet history is unavailable.');
  }

  const bySignature = new Map<string, {
    readonly entry: SignatureEntry;
    readonly wallets: Set<'private' | 'public'>;
  }>();
  for (const source of fulfilled) {
    for (const entry of source.entries) {
      if (!validEntry(entry)) continue;
      const existing = bySignature.get(entry.signature);
      if (existing === undefined) {
        bySignature.set(entry.signature, {
          entry,
          wallets: new Set([source.wallet]),
        });
      } else {
        existing.wallets.add(source.wallet);
      }
    }
  }

  return [...bySignature.entries()]
    .map(([signature, value]) => ({
      correlationKey: `solana-transaction:${privateIdentifier('solana-transaction', signature)}`,
      createdAtMs: (value.entry.blockTime as number) * 1_000,
      id: privateIdentifier('solana-wallet-activity', signature),
      outcome: value.entry.err === null ? 'success' as const : 'error' as const,
      wallet: value.wallets.size > 1
        ? 'transfer' as const
        : value.wallets.has('public') ? 'public' as const : 'private' as const,
    }))
    .sort((left, right) => right.createdAtMs - left.createdAtMs)
    .slice(0, HISTORY_LIMIT * addresses.length);
}

function uniqueAddresses(
  publicAddress: string,
  privateAddress: string,
): readonly { readonly address: string; readonly wallet: 'private' | 'public' }[] {
  return publicAddress === privateAddress
    ? [{ address: publicAddress, wallet: 'public' }]
    : [
        { address: publicAddress, wallet: 'public' },
        { address: privateAddress, wallet: 'private' },
      ];
}

function validEntry(value: SignatureEntry): boolean {
  return typeof value.signature === 'string'
    && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(value.signature)
    && typeof value.blockTime === 'number'
    && Number.isSafeInteger(value.blockTime)
    && value.blockTime > 0;
}
