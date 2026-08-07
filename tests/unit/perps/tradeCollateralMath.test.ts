import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collateralShortfall,
  fundingRequiredSol,
  scaledInputForMinimumOutput,
} from '../../../src/integrations/perps/tradeCollateralMath';

test('trade collateral math never underfunds a provider step', () => {
  assert.equal(collateralShortfall(50_000n, 20_000n), 30_000n);
  assert.equal(collateralShortfall(50_000n, 50_000n), 0n);
  assert.equal(fundingRequiredSol(5_000n, 2_039_280n), 2_044_280n);
  assert.equal(scaledInputForMinimumOutput(1_000_000n, 1_000_000n, 995_000n), 1_005_026n);
});
