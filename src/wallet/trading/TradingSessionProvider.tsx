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
import {
  readTradingWalletIdentity,
  writeTradingWalletIdentity,
} from '@/storage/trading-wallet-identity';
import {
  DERIVATION_MESSAGE,
  checkTradingWalletIdentity,
  deriveTradingWallet,
  verifyDerivationSignature,
  zeroize,
  type TradingWalletIdentity,
} from '@/wallet/trading/derivation';

export type TradingSessionStatus =
  | 'waiting-for-wallet'
  | 'locked'
  | 'unlocking'
  | 'ready'
  | 'recovery-required'
  | 'error';

type TradingSession = {
  readonly status: TradingSessionStatus;
  readonly address: string | null;
  readonly signer: GatewayRequestSigner | null;
  readonly recovery: TradingSessionRecovery | null;
  readonly unlock: () => Promise<void>;
  readonly lock: () => void;
  readonly replaceRecordedIdentity: () => Promise<void>;
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
  const mainWalletAddress = isConnected(wallet)
    ? (wallet.wallets[0]?.address ?? null)
    : null;
  const [status, setStatus] = useState<TradingSessionStatus>(
    mainWalletAddress === null ? 'waiting-for-wallet' : 'locked',
  );
  const [address, setAddress] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<TradingSessionRecovery | null>(null);
  const seedRef = useRef<Uint8Array | null>(null);
  const walletAddressRef = useRef(mainWalletAddress);
  const unlockingRef = useRef(false);

  const clearSecret = useCallback(() => {
    if (seedRef.current !== null) {
      zeroize(seedRef.current);
      seedRef.current = null;
    }
  }, []);

  useEffect(() => {
    walletAddressRef.current = mainWalletAddress;
    unlockingRef.current = false;
    clearSecret();
    setAddress(null);
    setRecovery(null);
    setStatus(mainWalletAddress === null ? 'waiting-for-wallet' : 'locked');
  }, [clearSecret, mainWalletAddress]);

  useEffect(() => clearSecret, [clearSecret]);

  const lock = useCallback(() => {
    clearSecret();
    setAddress(null);
    setRecovery(null);
    setStatus(mainWalletAddress === null ? 'waiting-for-wallet' : 'locked');
  }, [clearSecret, mainWalletAddress]);

  const unlock = useCallback(async () => {
    if (
      unlockingRef.current ||
      !isConnected(wallet) ||
      mainWalletAddress === null
    ) {
      return;
    }

    const embeddedWallet = wallet.wallets[0];

    if (embeddedWallet === undefined) {
      setStatus('error');
      return;
    }

    unlockingRef.current = true;
    setStatus('unlocking');

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
      const derived = deriveTradingWallet(signature, mainWalletAddress);
      const recorded = await readTradingWalletIdentity(mainWalletAddress);
      const identity = checkTradingWalletIdentity(recorded, derived);

      if (walletAddressRef.current !== mainWalletAddress) {
        zeroize(derived.secretKey);
        return;
      }

      if (
        identity.status === 'mismatch' ||
        identity.status === 'version-upgrade'
      ) {
        zeroize(derived.secretKey);
        setRecovery({
          reason: identity.status,
          recorded: identity.recorded,
          derived: identity.derived,
        });
        setStatus('recovery-required');
        return;
      }

      if (identity.status === 'first-derivation') {
        await writeTradingWalletIdentity(mainWalletAddress, derived);
      }

      clearSecret();
      setRecovery(null);
      seedRef.current = derived.secretKey;
      setAddress(derived.address);
      setStatus('ready');
    } catch (cause) {
      clearSecret();
      setAddress(null);
      setStatus('error');
      logUnlockError(cause);
    } finally {
      unlockingRef.current = false;
    }
  }, [clearSecret, mainWalletAddress, wallet]);

  const replaceRecordedIdentity = useCallback(async () => {
    if (mainWalletAddress === null || recovery === null) {
      return;
    }

    await writeTradingWalletIdentity(mainWalletAddress, recovery.derived);

    if (walletAddressRef.current === mainWalletAddress) {
      setRecovery(null);
      setStatus('locked');
    }
  }, [mainWalletAddress, recovery]);

  const signer = useMemo<GatewayRequestSigner | null>(() => {
    if (status !== 'ready' || address === null) {
      return null;
    }

    return {
      publicKey: base58.decode(address),
      sign: async (message) => {
        const seed = seedRef.current;

        if (seed === null) {
          throw new Error('Trading wallet is locked.');
        }

        return ed25519.sign(message, seed);
      },
    };
  }, [address, status]);

  const value = useMemo(
    () => ({
      address,
      lock,
      recovery,
      replaceRecordedIdentity,
      signer,
      status,
      unlock,
    }),
    [
      address,
      lock,
      recovery,
      replaceRecordedIdentity,
      signer,
      status,
      unlock,
    ],
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

function logUnlockError(cause: unknown): void {
  if (__DEV__) {
    console.error('[Perpal trading wallet unlock failed]', {
      errorName: cause instanceof Error ? cause.name : typeof cause,
    });
  }
}
