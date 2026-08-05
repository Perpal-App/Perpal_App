import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import {
  buildVelocityInitializationTransaction,
  velocityInitializationAddresses,
  verifyVelocityInitializationPlan,
  type VelocityInitializationTransactionPlan,
} from '@/integrations/perps/velocity/velocityInitializationTransaction';
import {
  buildVelocityCollateralDepositTransaction,
  verifyVelocityCollateralDepositPlan,
  type VelocityCollateralDepositTransactionPlan,
} from '@/integrations/perps/velocity/velocityCollateralDepositTransaction';
import {
  buildVelocityMarketOrderTransaction,
  verifyVelocityMarketOrderPlan,
  type VelocityMarketOrderTransactionPlan,
} from '@/integrations/perps/velocity/velocityMarketOrderTransaction';

const PROGRAM_ID = 'vELoC1audYbSYVRXn1vPaV8Axoa9oU6BYmNGZZBDZ1P';

function plan(): VelocityInitializationTransactionPlan {
  const owner = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
  const recentBlockhash = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
  const addresses = velocityInitializationAddresses(PROGRAM_ID, owner);
  const transaction = buildVelocityInitializationTransaction({
    ...addresses,
    includeUserStats: true,
    programId: PROGRAM_ID,
    recentBlockhash,
  });

  return {
    ...addresses,
    includeUserStats: true,
    recentBlockhash,
    unsignedTransaction: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  };
}

describe('Velocity initialization verification', () => {
  it('accepts only the expected account initialization instructions', () => {
    const valid = plan();
    expect(() => verifyVelocityInitializationPlan(valid, PROGRAM_ID)).not.toThrow();

    const tampered = Transaction.from(valid.unsignedTransaction);
    const firstInstruction = tampered.instructions[0];

    if (firstInstruction === undefined) {
      throw new Error('Expected initialization instruction.');
    }

    firstInstruction.programId = SystemProgram.programId;

    expect(() =>
      verifyVelocityInitializationPlan(
        {
          ...valid,
          unsignedTransaction: tampered.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
        },
        PROGRAM_ID,
      ),
    ).toThrow('does not match Velocity account initialization');
  });
});

describe('Velocity collateral deposit verification', () => {
  it('rejects a deposit whose program was changed after preparation', () => {
    const owner = key(1);
    const recentBlockhash = key(2);
    const input = {
      owner,
      userAccount: key(3),
      userStatsAccount: key(4),
      userTokenAccount: key(5),
      spotMarketAccount: key(6),
      spotMarketVault: key(7),
      spotMarketOracle: key(8),
      amountBaseUnits: 12_500_000n,
      programId: PROGRAM_ID,
      recentBlockhash,
    };
    const transaction = buildVelocityCollateralDepositTransaction(input);
    const valid: VelocityCollateralDepositTransactionPlan = {
      ...input,
      unsignedTransaction: transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
    };

    expect(() => verifyVelocityCollateralDepositPlan(valid, PROGRAM_ID)).not.toThrow();

    const tampered = Transaction.from(valid.unsignedTransaction);
    const instruction = tampered.instructions[0];

    if (instruction === undefined) {
      throw new Error('Expected deposit instruction.');
    }

    instruction.programId = SystemProgram.programId;

    expect(() =>
      verifyVelocityCollateralDepositPlan(
        {
          ...valid,
          unsignedTransaction: tampered.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
        },
        PROGRAM_ID,
      ),
    ).toThrow('does not match the Velocity USDT deposit');
  });
});

describe('Velocity market-order verification', () => {
  it('rejects an order whose Velocity instruction was replaced', () => {
    const input = {
      owner: key(10),
      stateAccount: key(11),
      userAccount: key(12),
      userStatsAccount: key(13),
      remainingAccounts: [
        { address: key(14), writable: false },
        { address: key(15), writable: true },
      ],
      marketIndex: 0,
      side: 'long' as const,
      reduceOnly: false,
      baseAssetAmount: 1_000_000n,
      limitPrice: 200_000_000n,
      auctionStartPrice: 199_000_000n,
      auctionDurationSlots: 5,
      orderExpiryUnixSeconds: 1_800_000_000n,
      programId: PROGRAM_ID,
      recentBlockhash: key(16),
    };
    const transaction = buildVelocityMarketOrderTransaction(input);
    const valid: VelocityMarketOrderTransactionPlan = {
      ...input,
      unsignedTransaction: transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
    };

    expect(() => verifyVelocityMarketOrderPlan(valid, PROGRAM_ID)).not.toThrow();

    const tampered = Transaction.from(valid.unsignedTransaction);
    const tradeInstruction = tampered.instructions[2];
    if (tradeInstruction === undefined) {
      throw new Error('Expected Velocity order instruction.');
    }
    tradeInstruction.programId = SystemProgram.programId;

    expect(() =>
      verifyVelocityMarketOrderPlan(
        {
          ...valid,
          unsignedTransaction: tampered.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
        },
        PROGRAM_ID,
      ),
    ).toThrow('does not match the confirmed Velocity order');
  });
});

function key(fill: number): string {
  return new PublicKey(new Uint8Array(32).fill(fill)).toBase58();
}
