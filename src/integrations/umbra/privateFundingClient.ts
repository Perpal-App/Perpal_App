import { getUmbraClient, type IUmbraClient } from '@umbra-privacy/sdk/client';
import {
  getBatchMerkleProofFetcher,
  getDefaultIndexerDeps,
  getMerkleProofFetcher,
  getTreeSummaryFetcher,
  getUtxoDataFetcher,
  type IndexerDeps,
} from '@umbra-privacy/sdk/indexer';
import type { UmbraRelayer } from '@umbra-privacy/sdk/relayer';
import { createInMemoryUtxoDataStore } from '@umbra-privacy/sdk/store-adapters';

import type { AppConfig } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';
import type { UmbraGatewayDependencies } from '@/integrations/umbra/umbraGateway';
import { createSignedPollingComputationMonitor } from '@/integrations/umbra/umbraComputationMonitor';
import {
  readUmbraMasterSeed,
  writeUmbraMasterSeed,
} from '@/integrations/umbra/umbraSecureStorage';

const INDEXER_TIMEOUT_MS = 15_000;

export async function createPrivateFundingClient(input: {
  readonly config: AppConfig;
  readonly dependencies: UmbraGatewayDependencies;
  readonly gatewaySigner: GatewayRequestSigner;
  readonly mainWalletAddress: string;
}): Promise<IUmbraClient> {
  const utxoDataStore = createInMemoryUtxoDataStore({
    onError: (_error, operation) => {
      console.error('[Perpal Umbra indexer]', JSON.stringify({
        event: 'store_error',
        operation,
      }));
    },
  });
  const client = await getUmbraClient(
    {
      signer: input.dependencies.signer,
      network: 'mainnet',
      rpcUrl: input.config.api.rpcUrl,
      rpcSubscriptionsUrl: websocketUrl(input.config.api.rpcUrl),
      indexerApiEndpoint: input.config.privacy.umbraIndexerUrl,
      deferMasterSeedSignature: true,
      signSchemeMessages: 'deferred',
    },
    {
      accountInfoProvider: input.dependencies.accountInfoProvider,
      blockhashProvider: input.dependencies.blockhashProvider,
      epochInfoProvider: input.dependencies.epochInfoProvider,
      transactionForwarder: input.dependencies.transactionForwarder,
      computationMonitor: createSignedPollingComputationMonitor({
        accountInfoProvider: input.dependencies.accountInfoProvider,
        rpcUrl: input.config.api.rpcUrl,
        signer: input.gatewaySigner,
      }),
      utxoDataStore,
      masterSeedStorage: {
        load: async () => {
          const seed = await readUmbraMasterSeed(input.mainWalletAddress);
          return seed === null
            ? { exists: false }
            : { exists: true, seed: seed as never };
        },
        store: async (seed) => {
          try {
            await writeUmbraMasterSeed(input.mainWalletAddress, seed);
            return { success: true };
          } catch {
            return { success: false, error: 'Secure storage failed.' };
          }
        },
      },
    },
  );

  const indexer = { apiEndpoint: input.config.privacy.umbraIndexerUrl };
  const indexerDeps = boundedIndexerDeps();
  return withStoredCurrentMasterSeed({
    ...client,
    fetchBatchMerkleProof: getBatchMerkleProofFetcher(indexer, indexerDeps),
    fetchMerkleProof: getMerkleProofFetcher(indexer, indexerDeps),
    fetchTreeSummary: getTreeSummaryFetcher(indexer, indexerDeps),
    fetchUtxoData: getUtxoDataFetcher(indexer, indexerDeps),
  });
}

function boundedIndexerDeps(): IndexerDeps {
  const defaults = getDefaultIndexerDeps();
  const boundedFetch: typeof globalThis.fetch = async (resource, options) => {
    const controller = new AbortController();
    const callerSignal = options?.signal;
    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), INDEXER_TIMEOUT_MS);

    try {
      return await defaults.fetch(resource, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  };

  return { ...defaults, fetch: boundedFetch };
}

export function withStoredCurrentMasterSeed(client: IUmbraClient): IUmbraClient {
  const currentSchemeId = client.masterSeedSchemes[0]?.id;

  if (currentSchemeId === undefined) {
    throw new PrivateFundingError(
      'Umbra recovery configuration is unavailable.',
      'master_seed_scheme_unavailable',
    );
  }

  let currentSeedPromise: ReturnType<
    IUmbraClient['masterSeed']['getMasterSeed']
  > | null = null;
  const getCurrentMasterSeed = () => {
    if (currentSeedPromise === null) {
      currentSeedPromise = client.masterSeed.getMasterSeed().catch((cause) => {
        currentSeedPromise = null;
        throw cause;
      });
    }

    return currentSeedPromise;
  };

  return {
    ...client,
    masterSeed: {
      ...client.masterSeed,
      getMasterSeed: getCurrentMasterSeed,
    },
    getSchemeMasterSeed: (schemeId) =>
      schemeId === currentSchemeId
        ? getCurrentMasterSeed()
        : client.getSchemeMasterSeed(schemeId),
  };
}

export async function assertRelayerSupportsMint(
  relayer: UmbraRelayer,
  mint: string,
): Promise<void> {
  const supported = await relayer.getSupportedMints();

  if (!supported.mints.includes(mint)) {
    throw new PrivateFundingError(
      'Umbra relayer does not support a required private-funding mint.',
      'mint_unsupported',
    );
  }
}

function websocketUrl(rpcUrl: string): string {
  const url = new URL(rpcUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
