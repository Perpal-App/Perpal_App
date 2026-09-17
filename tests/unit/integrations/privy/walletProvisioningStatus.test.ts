import {
  resolveWalletProvisioningStatus,
  shouldProvisionWallet,
} from '@/integrations/privy/walletProvisioningStatus';

describe('Privy wallet restoration', () => {
  it('creates a missing embedded wallet after an authenticated session restore', () => {
    expect(
      shouldProvisionWallet({
        hasEmbeddedWallet: false,
        isAuthenticated: true,
        walletStatus: 'not-created',
      }),
    ).toBe(true);
    expect(resolveWalletProvisioningStatus({
      failed: false,
      isAuthenticated: true,
      walletStatus: 'not-created',
    })).toBe('provisioning');
  });

  it('never creates a second wallet for an account that already has one', () => {
    // The status the SDK reports before a session exists survives into the
    // commit where login lands. Acting on it would call `create()` for a
    // returning user, which Privy rejects and which leaves the wallet in error.
    expect(
      shouldProvisionWallet({
        hasEmbeddedWallet: true,
        isAuthenticated: true,
        walletStatus: 'not-created',
      }),
    ).toBe(false);
  });

  it('still recovers and reconnects an existing wallet', () => {
    expect(
      shouldProvisionWallet({
        hasEmbeddedWallet: true,
        isAuthenticated: true,
        walletStatus: 'needs-recovery',
      }),
    ).toBe(true);
    expect(
      shouldProvisionWallet({
        hasEmbeddedWallet: true,
        isAuthenticated: true,
        walletStatus: 'error',
      }),
    ).toBe(true);
  });
});
