import { CustomBorshCoder } from '@velocity-exchange/sdk/lib/browser/decode/customCoder';
import velocityIdl from '@velocity-exchange/sdk/lib/browser/idl/velocity.json';
import { BN } from '@velocity-exchange/sdk/lib/browser/isomorphic/anchor';
import { Buffer } from 'buffer';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';

const QUOTE_MARKET_INDEX = 0;
const coder = new CustomBorshCoder(
  velocityIdl as unknown as ConstructorParameters<typeof CustomBorshCoder>[0],
);

export type VelocityCollateralDepositTransactionPlan = {
  readonly owner: string;
  readonly userAccount: string;
  readonly userStatsAccount: string;
  readonly userTokenAccount: string;
  readonly spotMarketAccount: string;
  readonly spotMarketVault: string;
  readonly spotMarketOracle: string;
  readonly amountBaseUnits: bigint;
  readonly unsignedTransaction: Uint8Array;
  readonly recentBlockhash: string;
};

export class VelocityDepositVerificationError extends Error {
  constructor() {
    super('The prepared transaction does not match the Velocity USDT deposit.');
    this.name = 'VelocityDepositVerificationError';
  }
}

export function buildVelocityCollateralDepositTransaction(input: {
  readonly owner: string;
  readonly userAccount: string;
  readonly userStatsAccount: string;
  readonly userTokenAccount: string;
  readonly spotMarketAccount: string;
  readonly spotMarketVault: string;
  readonly spotMarketOracle: string;
  readonly amountBaseUnits: bigint;
  readonly programId: string;
  readonly recentBlockhash: string;
}): Transaction {
  const program = new PublicKey(input.programId);
  const authority = new PublicKey(input.owner);
  const state = PublicKey.findProgramAddressSync(
    [Buffer.from('velocity_state')],
    program,
  )[0];
  const keys: AccountMeta[] = [
    readonly(state),
    writable(new PublicKey(input.userAccount)),
    writable(new PublicKey(input.userStatsAccount)),
    signer(authority),
    writable(new PublicKey(input.spotMarketVault)),
    writable(new PublicKey(input.userTokenAccount)),
    readonly(TOKEN_PROGRAM_ID),
  ];
  const oracle = new PublicKey(input.spotMarketOracle);

  if (!oracle.equals(PublicKey.default)) {
    keys.push(readonly(oracle));
  }

  keys.push(writable(new PublicKey(input.spotMarketAccount)));

  return new Transaction({
    feePayer: authority,
    recentBlockhash: input.recentBlockhash,
  }).add(
    new TransactionInstruction({
      programId: program,
      keys,
      data: coder.instruction.encode('deposit', {
        market_index: QUOTE_MARKET_INDEX,
        // The browser shim subclasses bn.js but its generated declaration drops
        // the inherited constructor signature.
        amount: new (BN as unknown as { new (value: string): BN })(
          input.amountBaseUnits.toString(),
        ),
        reduce_only: false,
      }),
    }),
  );
}

export function verifyVelocityCollateralDepositPlan(
  plan: VelocityCollateralDepositTransactionPlan,
  programId: string,
): void {
  const expected = buildVelocityCollateralDepositTransaction({
    owner: plan.owner,
    userAccount: plan.userAccount,
    userStatsAccount: plan.userStatsAccount,
    userTokenAccount: plan.userTokenAccount,
    spotMarketAccount: plan.spotMarketAccount,
    spotMarketVault: plan.spotMarketVault,
    spotMarketOracle: plan.spotMarketOracle,
    amountBaseUnits: plan.amountBaseUnits,
    programId,
    recentBlockhash: plan.recentBlockhash,
  });
  const actual = Transaction.from(plan.unsignedTransaction);
  const instruction = actual.instructions[0];
  const expectedInstruction = expected.instructions[0];

  if (
    actual.feePayer?.toBase58() !== plan.owner ||
    actual.recentBlockhash !== plan.recentBlockhash ||
    actual.instructions.length !== 1 ||
    instruction === undefined ||
    expectedInstruction === undefined ||
    !instruction.programId.equals(expectedInstruction.programId) ||
    !instruction.data.equals(expectedInstruction.data) ||
    !sameKeys(instruction.keys, expectedInstruction.keys) ||
    actual.signatures.some(
      (entry) =>
        entry.signature !== null && entry.signature.some((byte) => byte !== 0),
    )
  ) {
    throw new VelocityDepositVerificationError();
  }

  const decoded = coder.instruction.decode(instruction.data);
  const data = decoded?.data as Record<string, unknown> | undefined;

  if (
    decoded?.name !== 'deposit' ||
    data?.market_index !== QUOTE_MARKET_INDEX ||
    data.reduce_only !== false ||
    typeof data.amount !== 'object' ||
    data.amount === null ||
    (data.amount as { toString(): string }).toString() !==
      plan.amountBaseUnits.toString()
  ) {
    throw new VelocityDepositVerificationError();
  }
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
