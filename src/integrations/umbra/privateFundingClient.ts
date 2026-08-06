import { getUmbraClient, type IUmbraClient } from '@umbra-privacy/sdk/client';
import type { UmbraRelayer } from '@umbra-privacy/sdk/relayer';

import type { AppConfig } from '@/config/appConfig';
import { PrivateFundingError } from '@/integrations/umbra/privateFundingErrors';
import type { UmbraGatewayDependencies } from '@/integrations/umbra/umbraGateway';
import {
  readUmbraMasterSeed,
  writeUmbraMasterSeed,
} from '@/integrations/umbra/umbraSecureStorage';

export async function createPrivateFundingClient(input: {
  readonly config: AppConfig;
  readonly dependencies: UmbraGatewayDependencies;
  readonly mainWalletAddress: string;
}): Promise<IUmbraClient> {
  return getUmbraClient(
    {
      signer: input.dependencies.signer,
      network: 'mainnet',
      rpcUrl: input.config.api.rpcUrl,
      rpcSubscriptionsUrl: websocketUrl(input.config.api.rpcUrl),
      indexerApiEndpoint: input.config.privacy.umbraIndexerUrl,
      signSchemeMessages: 'deferred',
    },
    {
      accountInfoProvider: input.dependencies.accountInfoProvider,
      blockhashProvider: input.dependencies.blockhashProvider,
      epochInfoProvider: input.dependencies.epochInfoProvider,
      transactionForwarder: input.dependencies.transactionForwarder,
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
