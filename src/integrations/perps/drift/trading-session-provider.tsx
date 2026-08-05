import { isConnected, useEmbeddedSolanaWallet } from '@privy-io/expo';
import { base64 } from '@scure/base';
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

import { openDriftDevnetSession } from '@/integrations/perps/drift/driftDevnet';
import {
  readTradingWalletIdentity,
  writeTradingWalletIdentity,
} from '@/storage/trading-wallet-identity';
import {
  DERIVATION_MESSAGE,
  checkTradingWalletIdentity,
  deriveTradingWallet,
  zeroize,
} from '@/wallet/trading/derivation';

export type TradingSessionStatus =
  | 'unavailable'
  | 'locked'
  | 'unlocking'
  | 'ready'
  | 'identity-mismatch'
  | 'error';

type TradingSessionContextValue = {
  readonly status: TradingSessionStatus;
  readonly mainWalletAddress: string | null;
  readonly tradingWalletAddress: string | null;
  readonly unlock: () => Promise<void>;
  readonly lock: () => Promise<void>;
};

type DriftSession = ReturnType<typeof openDriftDevnetSession>;
type TradingSessionPhase =
  | 'wallet-provider'
  | 'derivation-signature'
  | 'wallet-derivation'
  | 'identity-read'
  | 'identity-write'
  | 'drift-open'
  | 'drift-subscribe';

const TradingSessionContext = createContext<TradingSessionContextValue | null>(
  null,
);

export function TradingSessionProvider({
  children,
  enabled,
  rpcUrl,
}: {
  readonly children: ReactNode;
  readonly enabled: boolean;
  readonly rpcUrl: string;
}) {
  const walletState = useEmbeddedSolanaWallet();
  const wallet = isConnected(walletState) ? walletState.wallets[0] : undefined;
  const mainWalletAddress = wallet?.address ?? null;
  const [status, setStatus] = useState<TradingSessionStatus>('unavailable');
  const [tradingWalletAddress, setTradingWalletAddress] = useState<string | null>(
    null,
  );
  const sessionRef = useRef<DriftSession | null>(null);
  const attemptRef = useRef(0);

  const closeCurrentSession = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;

    if (session !== null) {
      try {
        await session.close();
      } catch {
        // close() zeroes the key in finally; an unsubscribe error is non-fatal.
      }
    }
  }, []);

  useEffect(() => {
    const attempt = ++attemptRef.current;

    void closeCurrentSession().finally(() => {
      if (attempt === attemptRef.current) {
        setTradingWalletAddress(null);
        setStatus(enabled && mainWalletAddress !== null ? 'locked' : 'unavailable');
      }
    });

    return () => {
      attemptRef.current += 1;
      void closeCurrentSession();
    };
  }, [closeCurrentSession, enabled, mainWalletAddress]);

  const unlock = useCallback(async () => {
    if (!enabled || wallet === undefined || mainWalletAddress === null) {
      setStatus('unavailable');
      return;
    }

    const attempt = ++attemptRef.current;
    let seed: Uint8Array | null = null;
    let openedSession: DriftSession | null = null;
    let phase: TradingSessionPhase = 'wallet-provider';
    setStatus('unlocking');

    try {
      const provider = await wallet.getProvider();
      phase = 'derivation-signature';
      const { signature } = await provider.request({
        method: 'signMessage',
        params: { message: DERIVATION_MESSAGE },
      });
      phase = 'wallet-derivation';
      const derived = deriveTradingWallet(
        base64.decode(signature),
        mainWalletAddress,
      );
      seed = derived.secretKey;
      phase = 'identity-read';
      const recorded = await readTradingWalletIdentity(mainWalletAddress);
      const identity = checkTradingWalletIdentity(recorded, derived);

      if (identity.status === 'mismatch' || identity.status === 'version-upgrade') {
        if (attempt === attemptRef.current) {
          setStatus('identity-mismatch');
        }
        return;
      }

      if (identity.status === 'first-derivation') {
        phase = 'identity-write';
        await writeTradingWalletIdentity(mainWalletAddress, derived);
      }

      phase = 'drift-open';
      openedSession = openDriftDevnetSession(rpcUrl, seed);
      zeroize(seed);
      seed = null;

      phase = 'drift-subscribe';
      if (!(await openedSession.client.subscribe())) {
        throw new Error('Drift subscription was not established.');
      }

      if (attempt !== attemptRef.current) {
        return;
      }

      sessionRef.current = openedSession;
      openedSession = null;
      setTradingWalletAddress(derived.address);
      setStatus('ready');
    } catch (cause) {
      logTradingSessionFailure(phase, cause);

      if (attempt === attemptRef.current) {
        setTradingWalletAddress(null);
        setStatus('error');
      }
    } finally {
      if (seed !== null) {
        zeroize(seed);
      }

      if (openedSession !== null) {
        try {
          await openedSession.close();
        } catch {
          // The key was zeroed by close(); preserve the original state.
        }
      }
    }
  }, [enabled, mainWalletAddress, rpcUrl, wallet]);

  const lock = useCallback(async () => {
    ++attemptRef.current;
    await closeCurrentSession();
    setTradingWalletAddress(null);
    setStatus(enabled && mainWalletAddress !== null ? 'locked' : 'unavailable');
  }, [closeCurrentSession, enabled, mainWalletAddress]);

  const value = useMemo(
    () => ({
      status,
      mainWalletAddress,
      tradingWalletAddress,
      unlock,
      lock,
    }),
    [lock, mainWalletAddress, status, tradingWalletAddress, unlock],
  );

  return (
    <TradingSessionContext.Provider value={value}>
      {children}
    </TradingSessionContext.Provider>
  );
}

function logTradingSessionFailure(
  phase: TradingSessionPhase,
  cause: unknown,
): void {
  if (!__DEV__) {
    return;
  }

  const candidate =
    typeof cause === 'object' && cause !== null
      ? (cause as Record<string, unknown>)
      : null;
  const code = candidate?.code;
  const status = candidate?.status;

  console.error('[Perpal trading session failed]', {
    phase,
    errorName: cause instanceof Error ? cause.name : typeof cause,
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    ...(typeof status === 'number' ? { status } : {}),
  });
}

export function useTradingSession(): TradingSessionContextValue {
  const session = useContext(TradingSessionContext);

  if (session === null) {
    throw new Error('useTradingSession must be used inside TradingSessionProvider.');
  }

  return session;
}
