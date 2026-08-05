import {
  getUserAccountPublicKeySync,
  getUserStatsAccountPublicKey,
} from '@velocity-exchange/sdk/lib/browser/addresses/pda';
import { CustomBorshCoder } from '@velocity-exchange/sdk/lib/browser/decode/customCoder';
import velocityIdl from '@velocity-exchange/sdk/lib/browser/idl/velocity.json';
import { DEFAULT_USER_NAME, encodeName } from '@velocity-exchange/sdk/lib/browser/userName';
import { Buffer } from 'buffer';
import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';

const SUB_ACCOUNT_ID = 0;
const coder = new CustomBorshCoder(
  velocityIdl as unknown as ConstructorParameters<typeof CustomBorshCoder>[0],
);

export type VelocityInitializationTransactionPlan = {
  readonly owner: string;
  readonly userAccount: string;
  readonly userStatsAccount: string;
  readonly includeUserStats: boolean;
  readonly unsignedTransaction: Uint8Array;
  readonly recentBlockhash: string;
};

export class VelocityInitializationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'VelocityInitializationError';
  }
}

export function velocityInitializationAddresses(
  programId: string,
  owner: string,
): {
  readonly owner: string;
  readonly userAccount: string;
  readonly userStatsAccount: string;
} {
  const program = new PublicKey(programId);
  const authority = new PublicKey(owner);

  return {
    owner,
    userAccount: getUserAccountPublicKeySync(
      program,
      authority,
      SUB_ACCOUNT_ID,
    ).toBase58(),
    userStatsAccount: getUserStatsAccountPublicKey(
      program,
      authority,
    ).toBase58(),
  };
}

export function buildVelocityInitializationTransaction(input: {
  readonly owner: string;
  readonly userAccount: string;
  readonly userStatsAccount: string;
  readonly includeUserStats: boolean;
  readonly programId: string;
  readonly recentBlockhash: string;
}): Transaction {
  const program = new PublicKey(input.programId);
  const authority = new PublicKey(input.owner);
  const user = new PublicKey(input.userAccount);
  const userStats = new PublicKey(input.userStatsAccount);
  const state = PublicKey.findProgramAddressSync(
    [Buffer.from('velocity_state')],
    program,
  )[0];
  const transaction = new Transaction({
    feePayer: authority,
    recentBlockhash: input.recentBlockhash,
  });

  if (input.includeUserStats) {
    transaction.add(
      velocityInstruction(program, 'initialize_user_stats', {}, [
        writable(userStats),
        writable(state),
        readonly(authority),
        signer(authority),
        readonly(SYSVAR_RENT_PUBKEY),
        readonly(SystemProgram.programId),
      ]),
    );
  }

  transaction.add(
    velocityInstruction(
      program,
      'initialize_user',
      {
        sub_account_id: SUB_ACCOUNT_ID,
        name: encodeName(DEFAULT_USER_NAME),
      },
      [
        writable(user),
        writable(userStats),
        writable(state),
        readonly(authority),
        signer(authority),
        readonly(SYSVAR_RENT_PUBKEY),
        readonly(SystemProgram.programId),
      ],
    ),
  );

  return transaction;
}

export function velocityAccountSize(account: 'User' | 'UserStats'): number {
  return coder.accounts.size(account);
}

export function verifyVelocityInitializationPlan(
  plan: VelocityInitializationTransactionPlan,
  programId: string,
): void {
  const expected = buildVelocityInitializationTransaction({
    owner: plan.owner,
    userAccount: plan.userAccount,
    userStatsAccount: plan.userStatsAccount,
    includeUserStats: plan.includeUserStats,
    programId,
    recentBlockhash: plan.recentBlockhash,
  });
  const actual = Transaction.from(plan.unsignedTransaction);

  if (
    actual.feePayer?.toBase58() !== plan.owner ||
    actual.recentBlockhash !== plan.recentBlockhash ||
    actual.instructions.length !== expected.instructions.length ||
    actual.signatures.some(
      (entry) =>
        entry.signature !== null && entry.signature.some((byte) => byte !== 0),
    )
  ) {
    throw verificationFailure();
  }

  actual.instructions.forEach((instruction, index) => {
    const expectedInstruction = expected.instructions[index];

    if (
      expectedInstruction === undefined ||
      !instruction.programId.equals(expectedInstruction.programId) ||
      !instruction.data.equals(expectedInstruction.data) ||
      !sameKeys(instruction.keys, expectedInstruction.keys)
    ) {
      throw verificationFailure();
    }

    const decoded = coder.instruction.decode(instruction.data);
    const expectedName =
      plan.includeUserStats && index === 0
        ? 'initialize_user_stats'
        : 'initialize_user';

    if (decoded?.name !== expectedName) {
      throw verificationFailure();
    }
  });
}

function velocityInstruction(
  programId: PublicKey,
  name: string,
  args: object,
  keys: AccountMeta[],
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys,
    data: coder.instruction.encode(name, args),
  });
}

function sameKeys(
  actual: readonly AccountMeta[],
  expected: readonly AccountMeta[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((entry, index) => {
      const target = expected[index];
      return (
        target !== undefined &&
        entry.pubkey.equals(target.pubkey) &&
        entry.isSigner === target.isSigner &&
        entry.isWritable === target.isWritable
      );
    })
  );
}

function readonly(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: false };
}

function writable(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: true };
}

function signer(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: true, isWritable: true };
}

function verificationFailure(): VelocityInitializationError {
  return new VelocityInitializationError(
    'The prepared transaction does not match Velocity account initialization.',
    'verification_failed',
  );
}
