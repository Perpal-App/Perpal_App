import { base64 } from '@scure/base';
import { isConnected, useEmbeddedSolanaWallet } from '@privy-io/expo';
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { readAppConfig } from '@/config/appConfig';
import { writeActivatedTradingWallet } from '@/storage/trading-wallet-identity';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
} from '@/storage/inAppNotifications';
import {
  DERIVATION_MESSAGE,
  verifyDerivationSignature,
  type DerivedTradingWallet,
} from '@/wallet/trading/derivation';
import {
  assertTradingWalletIdentityRetired,
} from '@/wallet/trading/rotationSafety';
import {
  deriveRecordedTradingWallet,
  signerForDerivedWallet,
  type RecoveryCandidate,
} from '@/wallet/trading/rotationRecovery';
import type {
  TradingSessionRecovery,
  TradingSessionStatus,
} from '@/wallet/trading/TradingSessionContext';

type EmbeddedWalletState = ReturnType<typeof useEmbeddedSolanaWallet>;

export function useTradingWalletRecovery(input: {
  readonly activatingRef: MutableRefObject<boolean>;
  readonly clearSecret: () => void;
  readonly mainWalletAddress: string | null;
  readonly recovery: TradingSessionRecovery | null;
  readonly recoveryCandidateRef: MutableRefObject<RecoveryCandidate | null>;
  readonly rootSeedRef: MutableRefObject<Uint8Array | null>;
  readonly seedRef: MutableRefObject<Uint8Array | null>;
  readonly setAddress: Dispatch<SetStateAction<string | null>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setGeneration: Dispatch<SetStateAction<number>>;
  readonly setRecovery: Dispatch<SetStateAction<TradingSessionRecovery | null>>;
  readonly setRotationPending: Dispatch<SetStateAction<boolean>>;
  readonly setStatus: Dispatch<SetStateAction<TradingSessionStatus>>;
  readonly status: TradingSessionStatus;
  readonly wallet: EmbeddedWalletState;
  readonly walletAddressRef: MutableRefObject<string | null>;
}): () => Promise<void> {
  return useCallback(async () => {
    const config = readAppConfig();
    const candidate = input.recoveryCandidateRef.current;
    if (
      input.activatingRef.current || !config.ok || input.status !== 'recovery-required' ||
      input.recovery === null || candidate === null || input.mainWalletAddress === null ||
      !isConnected(input.wallet)
    ) return;
    const embeddedWallet = input.wallet.wallets.find((entry) => entry.walletIndex === 0);
    if (embeddedWallet === undefined) return;

    const scopeToken = captureInAppNotificationScope();
    input.activatingRef.current = true;
    input.setError(null);
    input.setStatus('activating');
    let recordedWallet: DerivedTradingWallet | null = null;
    try {
      const provider = await embeddedWallet.getProvider();
      const { signature: encodedSignature } = await provider.request({
        method: 'signMessage',
        params: { message: base64.encode(new TextEncoder().encode(DERIVATION_MESSAGE)) },
      });
      const authorization = verifyDerivationSignature(
        encodedSignature,
        input.mainWalletAddress,
      );
      authorization.fill(0);
      recordedWallet = deriveRecordedTradingWallet(
        candidate,
        input.mainWalletAddress,
        input.recovery.recorded,
      );
      if (recordedWallet === null) {
        await assertTradingWalletIdentityRetired({
          candidateWalletAddress: candidate.wallet.address,
          config: config.value,
          mainWalletAddress: input.mainWalletAddress,
          signer: signerForDerivedWallet(candidate.wallet),
          tradingWalletAddress: input.recovery.recorded.address,
        });
      }
      if (input.walletAddressRef.current !== input.mainWalletAddress) return;

      const selected = recordedWallet ?? candidate.wallet;
      await writeActivatedTradingWallet(
        input.mainWalletAddress,
        selected,
        candidate.rootSecretKey,
      );
      input.recoveryCandidateRef.current = null;
      input.clearSecret();
      input.seedRef.current = selected.secretKey;
      input.rootSeedRef.current = candidate.rootSecretKey;
      input.setAddress(selected.address);
      input.setGeneration(selected.generation);
      input.setRecovery(null);
      input.setRotationPending(false);
      input.setStatus('ready');
      publishInAppNotification({
        kind: 'wallet',
        outcome: 'success',
        scopeToken,
        title: 'Private wallet recovered',
        message: recordedWallet === null
          ? 'The proposed identity is active after the recorded wallet was verified empty.'
          : 'Access to the recorded private-wallet generation was restored.',
      });
      if (recordedWallet !== null && candidate.wallet.secretKey !== recordedWallet.secretKey) {
        candidate.wallet.secretKey.fill(0);
      }
    } catch (cause) {
      const error = cause instanceof Error
        ? cause
        : new Error('Private-wallet recovery could not be verified.');
      input.setError(error.message);
      input.setStatus('recovery-required');
      publishInAppNotification({
        kind: 'wallet',
        outcome: 'error',
        scopeToken,
        title: 'Recorded wallet preserved',
        message: 'Recovery stopped before changing the private-wallet identity.',
      });
      throw error;
    } finally {
      if (
        recordedWallet !== null &&
        input.seedRef.current !== recordedWallet.secretKey
      ) recordedWallet.secretKey.fill(0);
      input.activatingRef.current = false;
    }
  }, [input]);
}
