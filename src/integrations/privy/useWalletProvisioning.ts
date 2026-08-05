import {
  isConnected,
  isCreating,
  isNotCreated,
  needsRecovery,
  useEmbeddedSolanaWallet,
  usePrivy,
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
  /** True while a create call is in flight or Privy reports a creating state. */
  isProvisioning: boolean;
  embeddedWalletAddress: string | null;
  retry: () => Promise<void>;
};

const WalletProvisioningContext = createContext<WalletProvisioning | null>(null);

/**
 * Ensures every authenticated user has an embedded Solana wallet (M).
 *
 * Privy persists the wallet server-side against the user, so logout, reinstall,
 * and new devices all restore the same wallet on the next login. This hook only
 * covers the gap where a user exists without a wallet — a fresh signup, or a
 * signup where creation previously failed.
 *
 * Creation is single-flight and guarded by Privy's own `isNotCreated` state, so
 * it can never mint a second wallet. The attempt flag resets on sign-out so a
 * failed provision is retried on the next session rather than being stuck.
 *
 * Recovery is surfaced, never performed silently: `needs-recovery` requires an
 * explicit user-driven flow.
 */
function useWalletProvisioningState(): WalletProvisioning {
  const { isReady, user } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const attemptedRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const isAuthenticated = isReady && user !== null;

  const provision = useCallback(async () => {
    if (!isAuthenticated || isConnected(wallet) || needsRecovery(wallet)) {
      return;
    }

    const create = wallet.create;

    if (attemptedRef.current || typeof create !== 'function') {
      return;
    }

    attemptedRef.current = true;
    setFailed(false);
    setCreating(true);

    try {
      await create();
    } catch (cause) {
      attemptedRef.current = false;
      setFailed(true);
      logProvisioningError(cause, wallet.status);
    } finally {
      setCreating(false);
    }
  }, [isAuthenticated, wallet]);

  useEffect(() => {
    if (!isAuthenticated) {
      // Reset so the next authenticated session retries provisioning.
      attemptedRef.current = false;
      setFailed(false);
      setCreating(false);
      return;
    }

    if (isNotCreated(wallet)) {
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
      isProvisioning: creating || isCreating(wallet),
      embeddedWalletAddress: isConnected(wallet)
        ? (wallet.wallets[0]?.address ?? null)
        : null,
      retry,
    }),
    [creating, failed, isAuthenticated, retry, wallet],
  );
}

function logProvisioningError(cause: unknown, walletStatus: string): void {
  if (!__DEV__) {
    return;
  }

  const metadata =
    typeof cause === 'object' && cause !== null
      ? (cause as Record<string, unknown>)
      : null;
  const code = metadata?.code ?? metadata?.privyErrorCode;

  console.error('[Perpal Privy wallet provisioning failed]', {
    walletStatus,
    errorName: cause instanceof Error ? cause.name : typeof cause,
    ...(typeof code === 'string' ? { errorCode: code } : {}),
  });
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
