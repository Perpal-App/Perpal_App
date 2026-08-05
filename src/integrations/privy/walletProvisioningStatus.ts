import type { EmbeddedSolanaWalletStatus } from '@privy-io/expo';

export type WalletProvisioningStatus =
  | 'unauthenticated'
  | 'provisioning'
  | 'ready'
  | 'needs-recovery'
  | 'error';

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

  if (walletStatus === 'needs-recovery') {
    return 'needs-recovery';
  }

  if (walletStatus === 'connected') {
    return 'ready';
  }

  if (failed || walletStatus === 'error') {
    return 'error';
  }

  return 'provisioning';
}
