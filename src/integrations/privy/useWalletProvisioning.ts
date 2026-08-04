import {
  hasError,
  isConnected,
  isCreating,
  isNotCreated,
  needsRecovery,
  useEmbeddedSolanaWallet,
  usePrivy,
} from '@privy-io/expo';
import { useEffect, useRef, useState } from 'react';

export type WalletProvisioningStatus =
  | 'unauthenticated'
  | 'provisioning'
  | 'ready'
  | 'needs-recovery'
  | 'error';

type WalletProvisioning = {
  status: WalletProvisioningStatus;
  /** True while a create call is in flight or Privy reports a creating state. */
  isProvisioning: boolean;
};

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
export function useWalletProvisioning(): WalletProvisioning {
  const { isReady, user } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const attemptedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  const isAuthenticated = isReady && user !== null;

  useEffect(() => {
    if (!isAuthenticated) {
      // Reset so the next authenticated session retries provisioning.
      attemptedRef.current = false;
      return;
    }

    if (attemptedRef.current || !isNotCreated(wallet)) {
      return;
    }

    const create = wallet.create;

    if (typeof create !== 'function') {
      return;
    }

    attemptedRef.current = true;
    let active = true;

    void (async () => {
      try {
        await create();

        if (active) {
          setFailed(false);
        }
      } catch {
        // Allow a retry on the next session; never surface SDK internals.
        attemptedRef.current = false;

        if (active) {
          setFailed(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [isAuthenticated, wallet]);

  return {
    status: resolveStatus({ failed, isAuthenticated, wallet }),
    isProvisioning: isNotCreated(wallet) || isCreating(wallet),
  };
}

function resolveStatus({
  failed,
  isAuthenticated,
  wallet,
}: {
  failed: boolean;
  isAuthenticated: boolean;
  wallet: ReturnType<typeof useEmbeddedSolanaWallet>;
}): WalletProvisioningStatus {
  if (!isAuthenticated) {
    return 'unauthenticated';
  }

  if (needsRecovery(wallet)) {
    return 'needs-recovery';
  }

  if (isConnected(wallet)) {
    return 'ready';
  }

  if (failed || hasError(wallet)) {
    return 'error';
  }

  return 'provisioning';
}
