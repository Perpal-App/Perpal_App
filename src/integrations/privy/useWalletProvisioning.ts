import {
  isConnected,
  isCreating,
  isNotCreated,
  needsRecovery,
  useEmbeddedSolanaWallet,
  usePrivy,
  useRecoverEmbeddedWallet,
} from '@privy-io/expo';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  resolveWalletProvisioningStatus,
  type WalletProvisioningStatus,
} from '@/integrations/privy/walletProvisioningStatus';

type WalletProvisioning = {
  status: WalletProvisioningStatus;
  /** True while wallet creation or recovery is in flight. */
  isProvisioning: boolean;
  embeddedWalletAddress: string | null;
  retry: () => Promise<void>;
};

const WalletProvisioningContext = createContext<WalletProvisioning | null>(null);

/**
 * Ensures every authenticated user has an embedded Solana wallet (M).
 *
 * Privy links the wallet to the authenticated user. New users get M with Privy
 * recovery, while an existing M is provisioned onto a new device automatically.
 *
 * Privy creates missing wallets during login. Recovery is single-flight and a
 * failed attempt stays stopped until the user retries or signs in again.
 */
function useWalletProvisioningState(): WalletProvisioning {
  const { isReady, user } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const { recover } = useRecoverEmbeddedWallet();
  const attemptedRef = useRef(false);
  const loggedStateRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [provisioning, setProvisioning] = useState(false);

  const isAuthenticated = isReady && user !== null;

  const provision = useCallback(async () => {
    if (!isAuthenticated || isConnected(wallet)) {
      return;
    }

    const action = needsRecovery(wallet)
      ? {
          operation: 'recover' as const,
          run: () => recover({ recoveryMethod: 'privy' as const }),
        }
      : isNotCreated(wallet)
        ? {
            operation: 'create' as const,
            run: () => wallet.create({ recoveryMethod: 'privy' as const }),
          }
        : null;

    if (attemptedRef.current || action === null) {
      return;
    }

    attemptedRef.current = true;
    setFailed(false);
    setProvisioning(true);
    logProvisioningEvent('started', action.operation, wallet.status);

    try {
      await action.run();
      logProvisioningEvent('completed', action.operation, wallet.status);
    } catch (cause) {
      setFailed(true);
      logProvisioningError(cause, action.operation, wallet.status);
    } finally {
      setProvisioning(false);
    }
  }, [isAuthenticated, recover, wallet]);

  useEffect(() => {
    const state = `${isAuthenticated}:${wallet.status}`;

    if (loggedStateRef.current === state) {
      return;
    }

    loggedStateRef.current = state;
    console.info('[Perpal Privy wallet]', JSON.stringify({
      authenticated: isAuthenticated,
      event: 'state',
      status: wallet.status,
    }));
  }, [isAuthenticated, wallet.status]);

  useEffect(() => {
    if (!isAuthenticated) {
      // Reset so the next authenticated session retries provisioning.
      attemptedRef.current = false;
      setFailed(false);
      setProvisioning(false);
      return;
    }

    if (needsRecovery(wallet)) {
      void provision();
    }
  }, [isAuthenticated, provision, wallet]);

  const retry = useCallback(async () => {
    attemptedRef.current = false;
    await provision();
  }, [provision]);

  return useMemo(
    () => ({
      status: resolveWalletProvisioningStatus({
        failed,
        isAuthenticated,
        walletStatus: wallet.status,
      }),
      isProvisioning: provisioning || isCreating(wallet),
      embeddedWalletAddress: wallet.wallets?.[0]?.address ?? null,
      retry,
    }),
    [failed, isAuthenticated, provisioning, retry, wallet],
  );
}

function logProvisioningError(
  cause: unknown,
  operation: 'create' | 'recover',
  walletStatus: string,
): void {
  const metadata =
    typeof cause === 'object' && cause !== null
      ? (cause as Record<string, unknown>)
      : null;
  const code = metadata?.code ?? metadata?.privyErrorCode;

  console.error('[Perpal Privy wallet]', JSON.stringify({
    event: 'failed',
    errorName: cause instanceof Error ? cause.name : typeof cause,
    ...(typeof code === 'string' ? { errorCode: code } : {}),
    operation,
    status: walletStatus,
  }));
}

function logProvisioningEvent(
  event: 'started' | 'completed',
  operation: 'create' | 'recover',
  walletStatus: string,
): void {
  console.info('[Perpal Privy wallet]', JSON.stringify({
    event,
    operation,
    status: walletStatus,
  }));
}

export function WalletProvisioningProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const value = useWalletProvisioningState();

  return createElement(WalletProvisioningContext.Provider, { value }, children);
}

export function useWalletProvisioning(): WalletProvisioning {
  const value = useContext(WalletProvisioningContext);

  if (value === null) {
    throw new Error(
      'useWalletProvisioning must be used inside WalletProvisioningProvider.',
    );
  }

  return value;
}
