import type { IUmbraClient } from '@umbra-privacy/sdk/client';
import {
  getMasterViewingKeyX25519KeypairDeriver,
  getTokenEncryptionX25519KeypairDeriver,
} from '@umbra-privacy/sdk/crypto/key-derivation';
import { getUserRegistrationFunction } from '@umbra-privacy/sdk/registration';

import type { AppConfig } from '@/config/appConfig';
import { createNativeUmbraProver } from '@/integrations/umbra/nativeProver';
import type { UmbraGatewayDependencies } from '@/integrations/umbra/umbraGateway';

export async function ensurePrivateFundingRegistration(input: {
  readonly client: IUmbraClient;
  readonly config: AppConfig;
  readonly dependencies: UmbraGatewayDependencies;
}): Promise<void> {
  console.info('[Perpal Umbra registration]', JSON.stringify({
    event: 'ensure_started',
  }));
  const tokenKeyDeriver = traceKeyDeriver(
    'token',
    getTokenEncryptionX25519KeypairDeriver({ client: input.client }),
  );
  const viewingKeyDeriver = traceKeyDeriver(
    'viewing',
    getMasterViewingKeyX25519KeypairDeriver({ client: input.client }),
  );
  const register = getUserRegistrationFunction(
    { client: input.client },
    {
      keys: {
        masterViewingKeyEncryptingX25519KeypairDeriver: viewingKeyDeriver,
        tokenEncryptionX25519KeypairDeriver: tokenKeyDeriver,
      },
      rpc: {
        accountInfoProvider: input.dependencies.accountInfoProvider,
        blockhashProvider: input.dependencies.blockhashProvider,
        transactionForwarder: input.dependencies.transactionForwarder,
      },
      zkProver: createNativeUmbraProver(
        input.config.privacy.umbraZkAssetBaseUrl,
        'userRegistration',
      ),
    },
  );

  const signatures = await register({
    anonymous: true,
    confidential: true,
    hooks: {
      onAccountFetchComplete: async (state) => {
        console.info('[Perpal Umbra registration]', JSON.stringify({
          anonymousReady: state.isAnonymous,
          event: 'account_checked',
          userAccountExists: state.userAccountExists,
          x25519Ready: state.hasX25519Key,
        }));
      },
      onZkProofGenerationStart: async () => {
        console.info('[Perpal Umbra registration]', JSON.stringify({
          event: 'proof_started',
        }));
      },
      initUserAccount: completedStep('account_initialized'),
      registerX25519PublicKey: completedStep('x25519_registered'),
      registerAnonymousUsage: completedStep('anonymous_registered'),
      onError: async ({ error, phase }) => {
        console.error('[Perpal Umbra registration]', JSON.stringify({
          errorMessage: safeErrorMessage(error),
          errorName: error instanceof Error ? error.name : typeof error,
          errorStack: safeErrorStack(error),
          event: 'failed',
          phase,
        }));
      },
    },
  });

  console.info('[Perpal Umbra registration]', JSON.stringify({
    event: 'ensure_completed',
    submittedTransactions: signatures.length,
  }));
}

function traceKeyDeriver<T>(name: string, derive: () => Promise<T>) {
  return async (): Promise<T> => {
    try {
      const result = await derive();
      console.info('[Perpal Umbra registration]', JSON.stringify({
        event: 'key_derived',
        key: name,
      }));
      return result;
    } catch (error) {
      console.error('[Perpal Umbra registration]', JSON.stringify({
        errorMessage: safeErrorMessage(error),
        errorStack: safeErrorStack(error),
        event: 'key_derivation_failed',
        key: name,
      }));
      throw error;
    }
  };
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/gu, '[address]')
    .replace(/[a-z0-9+/=_-]{64,}/giu, '[data]')
    .replace(/\s+/gu, ' ')
    .slice(0, 320);
}

function safeErrorStack(error: unknown): string | null {
  return error instanceof Error && error.stack !== undefined
    ? safeErrorMessage(error.stack)
    : null;
}

function completedStep(event: string) {
  return {
    onPostSend: async () => {
      console.info('[Perpal Umbra registration]', JSON.stringify({ event }));
    },
  };
}
