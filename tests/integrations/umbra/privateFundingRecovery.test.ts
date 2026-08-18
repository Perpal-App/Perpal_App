import { hasCompletedPrivateWalletFunding } from '@/integrations/umbra/privateFundingState';
import { nextPrivateFundingRelayRecoveryAttempt } from '@/integrations/umbra/privateFundingRelayRecovery';

it('finishes in T only after both claims and before any provider deposit', () => {
  expect(hasCompletedPrivateWalletFunding({
    claimSignature: 'collateral-claim',
    feeFundingSignature: 'fee-claim',
    providerDepositSignature: null,
  })).toBe(true);
  expect(hasCompletedPrivateWalletFunding({
    claimSignature: 'collateral-claim',
    feeFundingSignature: null,
    providerDepositSignature: null,
  })).toBe(false);
  expect(hasCompletedPrivateWalletFunding({
    claimSignature: 'collateral-claim',
    feeFundingSignature: 'fee-claim',
    providerDepositSignature: 'venue-deposit',
  })).toBe(false);
});

it('retries a submitted relay after a manual run aborts passive recovery', () => {
  const recoveryKey = 'operation:collateral:request';
  const firstAttempt = nextPrivateFundingRelayRecoveryAttempt({
    activeRefresh: 1,
    isRunning: false,
    lastAttemptKey: null,
    recoveryKey,
  });

  expect(firstAttempt).toBe(`${recoveryKey}:1`);
  expect(nextPrivateFundingRelayRecoveryAttempt({
    activeRefresh: 1,
    isRunning: false,
    lastAttemptKey: firstAttempt,
    recoveryKey,
  })).toBeNull();
  expect(nextPrivateFundingRelayRecoveryAttempt({
    activeRefresh: 1,
    isRunning: true,
    lastAttemptKey: firstAttempt,
    recoveryKey,
  })).toBeNull();
  expect(nextPrivateFundingRelayRecoveryAttempt({
    activeRefresh: 1,
    isRunning: false,
    lastAttemptKey: null,
    recoveryKey,
  })).toBe(`${recoveryKey}:1`);
});
