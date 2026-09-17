import type { EmbeddedSolanaWalletStatus } from '@privy-io/expo';

export type WalletProvisioningStatus =
  | 'unauthenticated'
  | 'provisioning'
  | 'ready'
  | 'needs-recovery'
  | 'error';

export type WalletProvisioningInput = {
  /**
   * True when the authenticated user already has an embedded Solana wallet on
   * their Privy account. Read from the user object, never from `walletStatus`.
   */
  readonly hasEmbeddedWallet: boolean;
  readonly isAuthenticated: boolean;
  readonly walletStatus: EmbeddedSolanaWalletStatus;
};

/**
 * Decide whether this app should drive the wallet, or leave it to the SDK.
 *
 * `not-created` does not mean "this account has no wallet". It is what the SDK
 * reports whenever it cannot see one, including when there is no session at all:
 * with no user it has no entropy to look one up with, so its first connect
 * attempt lands there. It then does not clear that status when a user arrives —
 * it transitions straight into its own connect attempt. On the commit where a
 * login lands, `walletStatus` is therefore still the pre-login `not-created`
 * while `isAuthenticated` has already turned true.
 *
 * Creating on that pair calls `create()` for an account that already has a
 * wallet. Privy re-reads the user, rejects it with
 * `embedded_wallet_creation_error` ("Solana wallet already exists for this
 * user") and leaves the wallet in `error` — a returning user is locked out of
 * their own wallet by a create they never needed.
 *
 * `hasEmbeddedWallet` comes from the user's linked accounts, which the SDK
 * derives during render and which is accurate on that same commit. When it is
 * true the wallet exists and the SDK's connect attempt is already in flight, so
 * the correct action here is none.
 */
export function shouldProvisionWallet({
  hasEmbeddedWallet,
  isAuthenticated,
  walletStatus,
}: WalletProvisioningInput): boolean {
  if (!isAuthenticated) {
    return false;
  }

  if (walletStatus === 'not-created') {
    return !hasEmbeddedWallet;
  }

  return walletStatus === 'needs-recovery' || walletStatus === 'error';
}

export function resolveWalletProvisioningStatus({
  failed,
  isAuthenticated,
  walletStatus,
}: {
  readonly failed: boolean;
  readonly isAuthenticated: boolean;
  readonly walletStatus: EmbeddedSolanaWalletStatus;
}): WalletProvisioningStatus {
  if (!isAuthenticated) {
    return 'unauthenticated';
  }

  if (walletStatus === 'connected') {
    return 'ready';
  }

  if (failed || walletStatus === 'error') {
    return 'error';
  }

  if (walletStatus === 'needs-recovery') {
    return 'needs-recovery';
  }

  return 'provisioning';
}
