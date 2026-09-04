import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { isConnected, useEmbeddedSolanaWallet } from '@privy-io/expo';
import {
  createContext,
  useCallback,
  useContext,
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
} from '@/storage/trading-wallet-identity';
import { publishInAppNotification } from '@/storage/inAppNotifications';
import {
  DERIVATION_MESSAGE,
  checkTradingWalletIdentity,
  deriveRotatedTradingWallet,
  deriveTradingWallet,
  verifyDerivationSignature,
  zeroize,
  type DerivedTradingWallet,
  type TradingWalletIdentity,
} from '@/wallet/trading/derivation';
import {
  prepareTradingWalletRotation,
  submitTradingWalletRotation,
} from '@/wallet/trading/rotationSafety';

export type TradingSessionStatus =
  | 'waiting-for-wallet'
  | 'restoring'
  | 'inactive'
  | 'activating'
  | 'rotating'
  | 'ready'
  | 'recovery-required'
  | 'error';

type TradingSession = {
  readonly status: TradingSessionStatus;
  readonly mainWalletAddress: string | null;
  readonly address: string | null;
  readonly signer: GatewayRequestSigner | null;
  readonly generation: number;
  readonly recovery: TradingSessionRecovery | null;
  readonly error: string | null;
  readonly activate: () => Promise<void>;
  readonly retryRestore: () => void;
  readonly rotate: () => Promise<void>;
};

export type TradingSessionRecovery = {
  readonly reason: 'mismatch' | 'version-upgrade';
  readonly recorded: TradingWalletIdentity;
  readonly derived: TradingWalletIdentity;
};

const TradingSessionContext = createContext<TradingSession | null>(null);

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
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const seedRef = useRef<Uint8Array | null>(null);
  const rootSeedRef = useRef<Uint8Array | null>(null);
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
  }, []);

  useEffect(() => {
    walletAddressRef.current = mainWalletAddress;
    activatingRef.current = false;
    automaticActivationRef.current = null;
    clearSecret();
    setAddress(null);
    setRecovery(null);
    setError(null);
    setGeneration(0);

    if (mainWalletAddress === null) {
      setStatus('waiting-for-wallet');
      return;
    }

    let cancelled = false;
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

          if (cancelled) {
            return;
          }

          seedRef.current = activated.secretKey;
          rootSeedRef.current = activated.rootSecretKey;
          retained = true;
          setAddress(activated.address);
          setGeneration(activated.generation);
          setStatus('ready');
        } finally {
          if (!retained) {
            activated.secretKey.fill(0);
            activated.rootSecretKey.fill(0);
          }
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError('The saved private trading wallet could not be verified.');
          setStatus('error');
          logActivationError('restore', cause);
          publishInAppNotification({
            kind: 'wallet',
            outcome: 'error',
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
        zeroize(derived.secretKey);
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
        title: 'Private trading activated',
        message: 'Private wallet T is ready for funding and trading.',
      });
    } catch (cause) {
      clearSecret();
      setAddress(null);
      setError('Private trading activation was not completed. Try again.');
      setStatus('error');
      logActivationError('activate', cause);
      publishInAppNotification({
        kind: 'wallet',
        outcome: 'error',
        title: 'Private trading setup paused',
        message: 'Retry the private wallet setup.',
      });
    } finally {
      if (derived !== null && seedRef.current !== derived.secretKey) {
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

  const rotate = useCallback(async () => {
    const config = readAppConfig();
    const rootSeed = rootSeedRef.current;
    if (
      !config.ok ||
      status !== 'ready' ||
      mainWalletAddress === null ||
      address === null ||
      signer === null ||
      rootSeed === null
    ) return;
    setStatus('rotating');
    setError(null);
    let next: DerivedTradingWallet | null = null;
    try {
      next = deriveRotatedTradingWallet(rootSeed, mainWalletAddress, generation + 1);
      const plan = await prepareTradingWalletRotation({
        config: config.value,
        mainWalletAddress,
        nextWalletAddress: next.address,
        signer,
        tradingWalletAddress: address,
      });
      await submitTradingWalletRotation(plan, {
        config: config.value,
        mainWalletAddress,
        signer,
        tradingWalletAddress: address,
      });
      await writeActivatedTradingWallet(mainWalletAddress, next, rootSeed);
      seedRef.current?.fill(0);
      seedRef.current = next.secretKey;
      setAddress(next.address);
      setGeneration(next.generation);
      setStatus('ready');
      publishInAppNotification({
        kind: 'wallet',
        outcome: 'success',
        title: 'Private wallet rotated',
        message: 'The new private wallet T is active and recovered SOL and account rent are available.',
      });
    } catch (cause) {
      if (next !== null && seedRef.current !== next.secretKey) zeroize(next.secretKey);
      setError(cause instanceof Error ? cause.message : 'Rotation safety could not be verified.');
      setStatus('ready');
      publishInAppNotification({
        kind: 'wallet',
        outcome: 'error',
        title: 'Private wallet not rotated',
        message: 'Balances or pending activity may still block rotation.',
      });
    }
  }, [address, generation, mainWalletAddress, signer, status]);

  const value = useMemo(
    () => ({
      activate,
      address,
      error,
      generation,
      mainWalletAddress,
      recovery,
      rotate,
      retryRestore,
      signer,
      status,
    }),
    [activate, address, error, generation, mainWalletAddress, recovery, retryRestore, rotate, signer, status],
  );

  return (
    <TradingSessionContext.Provider value={value}>
      {children}
    </TradingSessionContext.Provider>
  );
}

export function useTradingSession(): TradingSession {
  const session = useContext(TradingSessionContext);

  if (session === null) {
    throw new Error('useTradingSession must be used inside TradingSessionProvider.');
  }

  return session;
}

function logActivationError(
  phase: 'activate' | 'restore',
  cause: unknown,
): void {
  if (__DEV__) {
    console.error('[Perpal private trading wallet failed]', {
      phase,
      errorName: cause instanceof Error ? cause.name : typeof cause,
    });
  }
}
