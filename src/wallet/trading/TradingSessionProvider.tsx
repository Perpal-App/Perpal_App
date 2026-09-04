import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { isConnected, useEmbeddedSolanaWallet } from '@privy-io/expo';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { readAppConfig } from '@/config/appConfig';
import {
  readActivatedTradingWallet,
  readTradingWalletIdentity,
  writeActivatedTradingWallet,
  writeTradingWalletIdentity,
  type ActivatedTradingWallet,
} from '@/storage/trading-wallet-identity';
import { readTradingWalletRotation } from '@/storage/trading-wallet-rotation';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
} from '@/storage/inAppNotifications';
import {
  DERIVATION_MESSAGE,
  checkTradingWalletIdentity,
  deriveRotatedTradingWallet,
  deriveTradingWallet,
  verifyDerivationSignature,
  zeroize,
  type DerivedTradingWallet,
} from '@/wallet/trading/derivation';
import {
  finalizeTradingWalletRotation,
  prepareTradingWalletRotation,
  submitTradingWalletRotation,
  type TradingWalletRotationPlan,
} from '@/wallet/trading/rotationSafety';
import {
  reconcileActivatedTradingWallet,
  type RecoveryCandidate,
} from '@/wallet/trading/rotationRecovery';
import {
  TradingSessionContext,
  type TradingSessionRecovery,
  type TradingSessionStatus,
} from '@/wallet/trading/TradingSessionContext';
import { useTradingWalletRecovery } from '@/wallet/trading/useTradingWalletRecovery';
import { logTradingWalletError } from '@/wallet/trading/tradingWalletLog';

export { useTradingSession } from '@/wallet/trading/TradingSessionContext';
export type { TradingSessionRecovery, TradingSessionStatus } from '@/wallet/trading/TradingSessionContext';

export function TradingSessionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const wallet = useEmbeddedSolanaWallet();
  const primaryWallet = isConnected(wallet)
    ? wallet.wallets.find((candidate) => candidate.walletIndex === 0)
    : undefined;
  const mainWalletAddress = isConnected(wallet)
    ? (primaryWallet?.address ?? null)
    : null;
  const [status, setStatus] = useState<TradingSessionStatus>(
    mainWalletAddress === null ? 'waiting-for-wallet' : 'restoring',
  );
  const [address, setAddress] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<TradingSessionRecovery | null>(null);
  const [rotationPending, setRotationPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const seedRef = useRef<Uint8Array | null>(null);
  const rootSeedRef = useRef<Uint8Array | null>(null);
  const recoveryCandidateRef = useRef<RecoveryCandidate | null>(null);
  const walletAddressRef = useRef(mainWalletAddress);
  const activatingRef = useRef(false);
  const automaticActivationRef = useRef<string | null>(null);

  const clearSecret = useCallback(() => {
    if (seedRef.current !== null) {
      zeroize(seedRef.current);
      seedRef.current = null;
    }
    if (rootSeedRef.current !== null) {
      zeroize(rootSeedRef.current);
      rootSeedRef.current = null;
    }
    const candidate = recoveryCandidateRef.current;
    if (candidate !== null) {
      zeroize(candidate.wallet.secretKey);
      zeroize(candidate.rootSecretKey);
      recoveryCandidateRef.current = null;
    }
  }, []);

  useEffect(() => {
    walletAddressRef.current = mainWalletAddress;
    activatingRef.current = false;
    automaticActivationRef.current = null;
    clearSecret();
    setAddress(null);
    setRecovery(null);
    setRotationPending(false);
    setError(null);
    setGeneration(0);

    if (mainWalletAddress === null) {
      setStatus('waiting-for-wallet');
      return;
    }

    let cancelled = false;
    const scopeToken = captureInAppNotificationScope();
    setStatus('restoring');

    void readActivatedTradingWallet(mainWalletAddress)
      .then(async (activated) => {
        if (cancelled) {
          activated?.secretKey.fill(0);
          activated?.rootSecretKey.fill(0);
          return;
        }

        if (activated === null) {
          setStatus('inactive');
          return;
        }

        let retained = false;
        let selected: ActivatedTradingWallet = activated;

        try {
          const recorded = await readTradingWalletIdentity(mainWalletAddress);

          if (cancelled) {
            return;
          }

          const identity = checkTradingWalletIdentity(recorded, activated);

          if (
            identity.status === 'mismatch' ||
            identity.status === 'version-upgrade'
          ) {
            recoveryCandidateRef.current = {
              rootSecretKey: activated.rootSecretKey,
              wallet: activated,
            };
            retained = true;
            setRecovery({
              reason: identity.status,
              recorded: identity.recorded,
              derived: identity.derived,
            });
            setStatus('recovery-required');
            return;
          }

          if (identity.status === 'first-derivation') {
            await writeTradingWalletIdentity(mainWalletAddress, activated);
          }

          const config = readAppConfig();
          if (!config.ok) throw new Error('Private-wallet configuration is unavailable.');
          const rotation = await reconcileActivatedTradingWallet({
            activated,
            config: config.value,
            mainWalletAddress,
          });
          selected = rotation.wallet;

          if (cancelled) {
            return;
          }

          seedRef.current = selected.secretKey;
          rootSeedRef.current = selected.rootSecretKey;
          retained = true;
          setAddress(selected.address);
          setGeneration(selected.generation);
          setRotationPending(rotation.rotationPending);
          setStatus('ready');
        } finally {
          if (!retained) {
            selected.secretKey.fill(0);
            selected.rootSecretKey.fill(0);
            if (selected !== activated) {
              activated.secretKey.fill(0);
              activated.rootSecretKey.fill(0);
            }
          }
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError('The saved private trading wallet could not be verified.');
          setStatus('error');
          logTradingWalletError('restore', cause);
          publishInAppNotification({
            kind: 'wallet',
            outcome: 'error',
            scopeToken,
            title: 'Private wallet restore paused',
            message: 'Retry private wallet T from the profile screen.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clearSecret, mainWalletAddress, restoreAttempt]);

  useEffect(() => clearSecret, [clearSecret]);
  const activate = useCallback(async () => {
    if (
      activatingRef.current ||
      status !== 'inactive' ||
      !isConnected(wallet) ||
      mainWalletAddress === null
    ) {
      return;
    }

    const embeddedWallet = wallet.wallets.find(
      (candidate) => candidate.walletIndex === 0,
    );

    if (embeddedWallet === undefined) {
      setError('Privy wallet M is unavailable.');
      setStatus('error');
      return;
    }

    const scopeToken = captureInAppNotificationScope();
    activatingRef.current = true;
    setError(null);
    setStatus('activating');
    let derived: DerivedTradingWallet | null = null;

    try {
      const provider = await embeddedWallet.getProvider();
      const { signature: encodedSignature } = await provider.request({
        method: 'signMessage',
        params: {
          message: base64.encode(new TextEncoder().encode(DERIVATION_MESSAGE)),
        },
      });
      const signature = verifyDerivationSignature(
        encodedSignature,
        mainWalletAddress,
      );
      try {
        derived = deriveTradingWallet(signature, mainWalletAddress);
      } finally {
        signature.fill(0);
      }
      const recorded = await readTradingWalletIdentity(mainWalletAddress);
      const identity = checkTradingWalletIdentity(recorded, derived);

      if (walletAddressRef.current !== mainWalletAddress) {
        zeroize(derived.secretKey);
        return;
      }

      if (identity.status === 'mismatch' || identity.status === 'version-upgrade') {
        recoveryCandidateRef.current = {
          rootSecretKey: derived.secretKey.slice(),
          wallet: derived,
        };
        setRecovery({
          reason: identity.status,
          recorded: identity.recorded,
          derived: identity.derived,
        });
        setStatus('recovery-required');
        return;
      }

      await writeActivatedTradingWallet(mainWalletAddress, derived);

      if (walletAddressRef.current !== mainWalletAddress) {
        return;
      }

      clearSecret();
      seedRef.current = derived.secretKey;
      rootSeedRef.current = derived.secretKey.slice();
      setAddress(derived.address);
      setGeneration(derived.generation);
      setRecovery(null);
      setStatus('ready');
      publishInAppNotification({
        kind: 'wallet',
        outcome: 'success',
        scopeToken,
        title: 'Private trading activated',
        message: 'Private wallet T is ready for funding and trading.',
      });
    } catch (cause) {
      clearSecret();
      setAddress(null);
      setError('Private trading activation was not completed. Try again.');
      setStatus('error');
      logTradingWalletError('activate', cause);
      publishInAppNotification({
        kind: 'wallet',
        outcome: 'error',
        scopeToken,
        title: 'Private trading setup paused',
        message: 'Retry the private wallet setup.',
      });
    } finally {
      if (
        derived !== null &&
        seedRef.current !== derived.secretKey &&
        recoveryCandidateRef.current?.wallet.secretKey !== derived.secretKey
      ) {
        zeroize(derived.secretKey);
      }
      activatingRef.current = false;
    }
  }, [clearSecret, mainWalletAddress, status, wallet]);

  useEffect(() => {
    if (
      status !== 'inactive' ||
      mainWalletAddress === null ||
      automaticActivationRef.current === mainWalletAddress
    ) return;
    automaticActivationRef.current = mainWalletAddress;
    void activate();
  }, [activate, mainWalletAddress, status]);

  const retryRestore = useCallback(() => {
    automaticActivationRef.current = null;
    setRestoreAttempt((attempt) => attempt + 1);
  }, []);

  const recover = useTradingWalletRecovery({
    activatingRef,
    clearSecret,
    mainWalletAddress,
    recovery,
    recoveryCandidateRef,
    rootSeedRef,
    seedRef,
    setAddress,
    setError,
    setGeneration,
    setRecovery,
    setRotationPending,
    setStatus,
    status,
    wallet,
    walletAddressRef,
  });

  const signer = useMemo<GatewayRequestSigner | null>(() => {
    if (status !== 'ready' || address === null) {
      return null;
    }

    return {
      publicKey: base58.decode(address),
      sign: async (message) => {
        const seed = seedRef.current;

        if (seed === null) {
          throw new Error('Private trading wallet is unavailable.');
        }

        return ed25519.sign(message, seed);
      },
    };
  }, [address, status]);

  const prepareRotation = useCallback(async (): Promise<TradingWalletRotationPlan> => {
    const config = readAppConfig();
    const rootSeed = rootSeedRef.current;
    if (
      !config.ok ||
      status !== 'ready' ||
      mainWalletAddress === null ||
      address === null ||
      signer === null ||
      rootSeed === null
    ) throw new Error('Private wallet is not ready to review rotation.');
    const checkpoint = await readTradingWalletRotation(mainWalletAddress);
    const destinationGeneration = checkpoint?.destinationGeneration ?? generation + 1;
    const next = deriveRotatedTradingWallet(rootSeed, mainWalletAddress, destinationGeneration);
    try {
      if (checkpoint !== null && checkpoint.destinationWalletAddress !== next.address) {
        throw new Error('Saved rotation destination does not match the private-wallet root.');
      }
      return await prepareTradingWalletRotation({
        config: config.value,
        destinationGeneration,
        mainWalletAddress,
        nextWalletAddress: next.address,
        signer,
        tradingWalletAddress: address,
      });
    } finally {
      zeroize(next.secretKey);
    }
  }, [address, generation, mainWalletAddress, signer, status]);

  const rotate = useCallback(async (plan: TradingWalletRotationPlan) => {
    const config = readAppConfig();
    const rootSeed = rootSeedRef.current;
    if (
      !config.ok || status !== 'ready' || mainWalletAddress === null ||
      address === null || signer === null || rootSeed === null
    ) return;
    const scopeToken = captureInAppNotificationScope();
    setStatus('rotating');
    setError(null);
    let next: DerivedTradingWallet | null = null;
    let adopted = false;
    try {
      next = deriveRotatedTradingWallet(rootSeed, mainWalletAddress, plan.destinationGeneration);
      if (next.address !== plan.nextWalletAddress || plan.sourceWalletAddress !== address) {
        throw new Error('The reviewed rotation identities changed. Review it again.');
      }
      await submitTradingWalletRotation(plan, {
        config: config.value,
        mainWalletAddress,
        signer,
        tradingWalletAddress: address,
      });
      await writeActivatedTradingWallet(mainWalletAddress, next, rootSeed);
      seedRef.current?.fill(0);
      seedRef.current = next.secretKey;
      adopted = true;
      setAddress(next.address);
      setGeneration(next.generation);
      setRotationPending(false);
      setStatus('ready');
      await finalizeTradingWalletRotation(mainWalletAddress);
      publishInAppNotification({
        kind: 'wallet',
        outcome: 'success',
        scopeToken,
        title: 'Private wallet rotated',
        message: 'The new private wallet T is active and recovered SOL and account rent are available.',
      });
    } catch (cause) {
      if (next !== null && !adopted) zeroize(next.secretKey);
      const pending = await readTradingWalletRotation(mainWalletAddress).catch(() => null);
      setRotationPending(pending !== null);
      setError(cause instanceof Error ? cause.message : 'Rotation safety could not be verified.');
      setStatus('ready');
      publishInAppNotification({
        kind: 'wallet',
        outcome: 'error',
        scopeToken,
        title: 'Private wallet not rotated',
        message: pending === null
          ? 'Balances or pending activity may still block rotation.'
          : 'Rotation is safely checkpointed. Resume it after the pending step settles.',
      });
    }
  }, [address, mainWalletAddress, signer, status]);

  const value = useMemo(
    () => ({
      activate,
      address,
      error,
      generation,
      mainWalletAddress,
      prepareRotation,
      recovery,
      recover,
      rotate,
      rotationPending,
      retryRestore,
      signer,
      status,
    }),
    [
      activate, address, error, generation, mainWalletAddress, prepareRotation,
      recover, recovery, retryRestore, rotate, rotationPending, signer, status,
    ],
  );

  return (
    <TradingSessionContext.Provider value={value}>
      {children}
    </TradingSessionContext.Provider>
  );
}
