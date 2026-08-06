import {
  getDefaultArciumDeps,
  getPollingComputationMonitor,
  type ComputationMonitor,
} from '@umbra-privacy/sdk/arcium';
import type { AccountInfoProviderFunction } from '@umbra-privacy/sdk/solana';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';

export function createSignedPollingComputationMonitor(input: {
  readonly accountInfoProvider: AccountInfoProviderFunction;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
}): ComputationMonitor {
  const defaults = getDefaultArciumDeps();
  const rpc = {
    getSignaturesForAddress: (account: string, options?: { limit?: number }) => ({
      send: () => signedSolanaRpc<readonly {
        readonly err: unknown;
        readonly signature: string;
      }[]>({
        method: 'getSignaturesForAddress',
        params: [account, options ?? {}],
        rpcUrl: input.rpcUrl,
        signer: input.signer,
      }),
    }),
    getSlot: (options?: { commitment?: string }) => ({
      send: async () => BigInt(await signedSolanaRpc<number>({
        method: 'getSlot',
        params: [{ commitment: options?.commitment ?? 'confirmed' }],
        rpcUrl: input.rpcUrl,
        signer: input.signer,
      })),
    }),
  };

  return getPollingComputationMonitor(
    { rpcUrl: input.rpcUrl },
    {
      ...defaults,
      accountFetcher: {
        fetchEncodedAccount: async (_rpc, account, options) => {
          const accounts = await input.accountInfoProvider([account], options);
          const result = accounts.get(account);

          if (result === undefined) {
            throw new Error('Solana omitted the Umbra computation account.');
          }

          return result as never;
        },
      },
      rpcBuilders: {
        ...defaults.rpcBuilders,
        createRpc: () => rpc as never,
      },
    },
  );
}
