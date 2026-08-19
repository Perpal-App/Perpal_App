import {
  velocitySetupLeavesWalletBelowRent,
  velocitySetupSolShortfall,
} from '../../../src/integrations/perps/velocity/velocityTrade';
import { velocityCloseIntent } from '../../../src/integrations/perps/velocity/velocityAccount';

describe('Velocity setup SOL preflight', () => {
  it('derives the setup shortfall from the simulation instead of hardcoding rent', () => {
    expect(velocitySetupSolShortfall([
      'Transfer: insufficient lamports 22560683, need 32183040',
    ], 8_000n)).toBe(9_630_357n);
    expect(velocitySetupLeavesWalletBelowRent({
      InsufficientFundsForRent: { account_index: 0 },
    })).toBe(true);
  });
});

describe('Velocity position close', () => {
  it('closes the full on-chain size in the opposite direction', () => {
    expect(velocityCloseIntent(25_000_000n)).toEqual({
      amountBaseUnits: 25_000_000n,
      side: 'short',
    });
    expect(velocityCloseIntent(-25_000_000n)).toEqual({
      amountBaseUnits: 25_000_000n,
      side: 'long',
    });
  });
});
