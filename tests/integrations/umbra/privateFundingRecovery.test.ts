import assert from 'node:assert/strict';
import test from 'node:test';

import { hasCompletedPrivateWalletFunding } from '@/integrations/umbra/privateFundingState';

test('finishes in T only after both claims and before any provider deposit', () => {
  assert.equal(hasCompletedPrivateWalletFunding({
    claimSignature: 'collateral-claim',
    feeFundingSignature: 'fee-claim',
    providerDepositSignature: null,
  }), true);
  assert.equal(hasCompletedPrivateWalletFunding({
    claimSignature: 'collateral-claim',
    feeFundingSignature: null,
    providerDepositSignature: null,
  }), false);
  assert.equal(hasCompletedPrivateWalletFunding({
    claimSignature: 'collateral-claim',
    feeFundingSignature: 'fee-claim',
    providerDepositSignature: 'venue-deposit',
  }), false);
});
