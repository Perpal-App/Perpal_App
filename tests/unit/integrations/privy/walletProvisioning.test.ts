import {
  resolveWalletProvisioningStatus,
  shouldProvisionWallet,
} from '@/integrations/privy/walletProvisioningStatus';

describe('wallet provisioning status', () => {
  it('keeps unavailable and recovery states distinct from ready', () => {
    expect(
      resolveWalletProvisioningStatus({
        failed: false,
        isAuthenticated: true,
        walletStatus: 'connected',
      }),
    ).toBe('ready');
    expect(
      resolveWalletProvisioningStatus({
        failed: false,
        isAuthenticated: true,
        walletStatus: 'needs-recovery',
      }),
    ).toBe('needs-recovery');
    expect(
      resolveWalletProvisioningStatus({
        failed: true,
        isAuthenticated: true,
        walletStatus: 'not-created',
      }),
    ).toBe('error');
  });

  it('reconnects one failed wallet only after Privy restores authentication', () => {
    expect(
      shouldProvisionWallet({
        hasEmbeddedWallet: true,
        isAuthenticated: false,
        walletStatus: 'error',
      }),
    ).toBe(false);
    expect(
      shouldProvisionWallet({
        hasEmbeddedWallet: true,
        isAuthenticated: true,
        walletStatus: 'error',
      }),
    ).toBe(true);
    expect(
      shouldProvisionWallet({
        hasEmbeddedWallet: true,
        isAuthenticated: true,
        walletStatus: 'connected',
      }),
    ).toBe(false);
  });
});
