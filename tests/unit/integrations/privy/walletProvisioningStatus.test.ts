import {
  resolveWalletProvisioningStatus,
  shouldProvisionWallet,
} from '@/integrations/privy/walletProvisioningStatus';

describe('Privy wallet restoration', () => {
  it('creates a missing embedded wallet after an authenticated session restore', () => {
    expect(shouldProvisionWallet(true, 'not-created')).toBe(true);
    expect(resolveWalletProvisioningStatus({
      failed: false,
      isAuthenticated: true,
      walletStatus: 'not-created',
    })).toBe('provisioning');
  });
});
