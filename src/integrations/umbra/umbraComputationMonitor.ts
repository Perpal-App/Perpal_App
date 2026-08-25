import {
  getDefaultArciumDeps,
  getPollingComputationMonitor,
  type ComputationMonitor,
} from '@umbra-privacy/sdk/arcium';
import type { AccountInfoProviderFunction } from '@umbra-privacy/sdk/solana';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';

const CALLBACK_SIGNATURE_ATTEMPTS = 12;
const CALLBACK_SIGNATURE_INTERVAL_MS = 1_000;

export function createSignedPollingComputationMonitor(input: {
  readonly accountInfoProvider: AccountInfoProviderFunction;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
}): ComputationMonitor {
  const defaults = getDefaultArciumDeps();
  const rpc = {
    getSignaturesForAddress: (account: string, options?: { limit?: number }) => ({
      send: () => fetchCallbackSignatures(input, account, options),
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

async function fetchCallbackSignatures(
  input: {
    readonly rpcUrl: string;
    readonly signer: GatewayRequestSigner;
  },
  account: string,
  options?: { readonly limit?: number },
): Promise<readonly CallbackSignature[]> {
  for (let attempt = 1; attempt <= CALLBACK_SIGNATURE_ATTEMPTS; attempt += 1) {
    const signatures = await signedSolanaRpc<readonly CallbackSignature[]>({
      method: 'getSignaturesForAddress',
      params: [account, options ?? {}],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
    });

    if (
      signatures.some((entry) => entry.err === null) ||
      attempt === CALLBACK_SIGNATURE_ATTEMPTS
    ) {
      if (attempt > 1 && signatures.some((entry) => entry.err === null)) {
        console.info('[Perpal Umbra computation]', JSON.stringify({
          event: 'callback_signature_reconciled',
          retries: attempt - 1,
        }));
      }
      return signatures;
    }

    await wait(CALLBACK_SIGNATURE_INTERVAL_MS);
  }

  return [];
}

type CallbackSignature = {
  readonly err: unknown;
  readonly signature: string;
};

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
