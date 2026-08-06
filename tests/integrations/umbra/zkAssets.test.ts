import {
  UMBRA_RN_ZK_ASSET_VERSION,
  UMBRA_ZKEY_SPECS,
} from '@/integrations/umbra/zkAssets';

describe('Umbra native proving assets', () => {
  it('keeps rn-zk-prover 5 on the matching v5 asset set', () => {
    expect(UMBRA_RN_ZK_ASSET_VERSION).toBe('v5');
    expect(UMBRA_ZKEY_SPECS).toEqual({
      userRegistration: {
        bytes: 30_957_712,
        path: 'v5/zkey-wasm/userregistration.zkey',
      },
      createDepositWithPublicAmount: {
        bytes: 4_042_884,
        path: 'v5/zkey-wasm/createdepositwithpublicamount.zkey',
      },
      'claimDepositIntoPublicAmount:n1': {
        bytes: 40_771_972,
        path: 'v5/zkey-wasm/claimdepositintopublicamountn1.zkey',
      },
    });
  });
});
