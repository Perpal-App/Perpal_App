import { CustomBorshCoder } from '@velocity-exchange/sdk/lib/browser/decode/customCoder';
import velocityIdl from '@velocity-exchange/sdk/lib/browser/idl/velocity.json';
import { BN } from '@velocity-exchange/sdk/lib/browser/isomorphic/anchor';
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';

const COMPUTE_UNIT_LIMIT = 600_000;
const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 5_000;
const FULL_FILL_OPTION = (100 << 8) | 2;
const ISOLATED_POSITION_FLAG = 32;
const QUOTE_MARKET_INDEX = 0;
const coder = new CustomBorshCoder(
  velocityIdl as unknown as ConstructorParameters<typeof CustomBorshCoder>[0],
);

export type VelocityOrderSide = 'long' | 'short';

export type VelocityMarketOrderTransactionPlan = {
  readonly owner: string;
  readonly stateAccount: string;
  readonly userAccount: string;
  readonly userStatsAccount: string;
  readonly spotMarketVault: string;
  readonly remainingAccounts: readonly {
    readonly address: string;
    readonly writable: boolean;
  }[];
  readonly marketIndex: number;
  readonly side: VelocityOrderSide;
  readonly reduceOnly: boolean;
  readonly isolatedCollateralBaseUnits: bigint;
  readonly baseAssetAmount: bigint;
  readonly limitPrice: bigint;
  readonly auctionStartPrice: bigint;
  readonly auctionDurationSlots: number;
  readonly orderExpiryUnixSeconds: bigint;
  readonly unsignedTransaction: Uint8Array;
  readonly recentBlockhash: string;
};

export class VelocityOrderVerificationError extends Error {
  constructor() {
    super('The prepared transaction does not match the confirmed Velocity order.');
    this.name = 'VelocityOrderVerificationError';
  }
}

export function buildVelocityMarketOrderTransaction(input: Omit<
  VelocityMarketOrderTransactionPlan,
  'unsignedTransaction'
> & { readonly programId: string }): Transaction {
  const owner = new PublicKey(input.owner);
  const keys: AccountMeta[] = [
    readonly(new PublicKey(input.stateAccount)),
    writable(new PublicKey(input.userAccount)),
    writable(new PublicKey(input.userStatsAccount)),
    signer(owner),
    ...input.remainingAccounts.map((account) => ({
      pubkey: new PublicKey(account.address),
      isSigner: false,
      isWritable: account.writable,
    })),
  ];
  const params = {
    order_type: { market: {} },
    market_type: { perp: {} },
    direction: input.side === 'long' ? { long: {} } : { short: {} },
    user_order_id: 0,
    base_asset_amount: bn(input.baseAssetAmount),
    price: bn(input.limitPrice),
    market_index: input.marketIndex,
    reduce_only: input.reduceOnly,
    post_only: { none: {} },
    bit_flags: ISOLATED_POSITION_FLAG,
    max_ts: bn(input.orderExpiryUnixSeconds),
    trigger_price: null,
    trigger_condition: { above: {} },
    oracle_price_offset: null,
    auction_duration: input.auctionDurationSlots,
    auction_start_price: bn(input.auctionStartPrice),
    auction_end_price: bn(input.limitPrice),
    builder_idx: null,
    builder_fee_tenth_bps: null,
  };

  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: input.recentBlockhash,
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    }),
  );

  if (input.isolatedCollateralBaseUnits > 0n) {
    transaction.add(
      new TransactionInstruction({
        programId: new PublicKey(input.programId),
        keys: [
          writable(new PublicKey(input.userAccount)),
          writable(new PublicKey(input.userStatsAccount)),
          signer(owner),
          readonly(new PublicKey(input.stateAccount)),
          readonly(new PublicKey(input.spotMarketVault)),
          ...input.remainingAccounts.map((account) => ({
            pubkey: new PublicKey(account.address),
            isSigner: false,
            isWritable: account.writable,
          })),
        ],
        data: coder.instruction.encode('transfer_isolated_perp_position_deposit', {
          spot_market_index: QUOTE_MARKET_INDEX,
          perp_market_index: input.marketIndex,
          amount: bn(input.isolatedCollateralBaseUnits),
        }),
      }),
    );
  }

  return transaction.add(
    new TransactionInstruction({
      programId: new PublicKey(input.programId),
      keys,
      data: coder.instruction.encode('place_and_take_perp_order', {
        params,
        success_condition: FULL_FILL_OPTION,
      }),
    }),
  );
}

export function verifyVelocityMarketOrderPlan(
  plan: VelocityMarketOrderTransactionPlan,
  programId: string,
): void {
  const expected = buildVelocityMarketOrderTransaction({ ...plan, programId });
  const actual = Transaction.from(plan.unsignedTransaction);

  if (
    actual.feePayer?.toBase58() !== plan.owner ||
    actual.recentBlockhash !== plan.recentBlockhash ||
    actual.instructions.length !== expected.instructions.length ||
    actual.instructions.some((instruction, index) => {
      const target = expected.instructions[index];
      return (
        target === undefined ||
        !instruction.programId.equals(target.programId) ||
        !instruction.data.equals(target.data) ||
        !sameKeys(instruction.keys, target.keys)
      );
    }) ||
    actual.signatures.some(
      (entry) =>
        entry.signature !== null && entry.signature.some((byte) => byte !== 0),
    )
  ) {
    throw new VelocityOrderVerificationError();
  }

  const tradeInstruction = actual.instructions[
    plan.isolatedCollateralBaseUnits > 0n ? 3 : 2
  ];
  const decoded = tradeInstruction === undefined
    ? null
    : coder.instruction.decode(tradeInstruction.data);
  const data = decoded?.data as Record<string, unknown> | undefined;
  const params = data?.params as Record<string, unknown> | undefined;

  if (
    decoded?.name !== 'place_and_take_perp_order' ||
    data?.success_condition !== FULL_FILL_OPTION ||
    params?.market_index !== plan.marketIndex ||
    params?.reduce_only !== plan.reduceOnly ||
    params?.bit_flags !== ISOLATED_POSITION_FLAG ||
    bnString(params?.base_asset_amount) !== plan.baseAssetAmount.toString() ||
    bnString(params?.price) !== plan.limitPrice.toString() ||
    bnString(params?.max_ts) !== plan.orderExpiryUnixSeconds.toString()
  ) {
    throw new VelocityOrderVerificationError();
  }

  if (plan.isolatedCollateralBaseUnits > 0n) {
    const transfer = actual.instructions[2];
    const decodedTransfer = transfer === undefined
      ? null
      : coder.instruction.decode(transfer.data);
    const transferData = decodedTransfer?.data as Record<string, unknown> | undefined;

    if (
      decodedTransfer?.name !== 'transfer_isolated_perp_position_deposit' ||
      transferData?.spot_market_index !== QUOTE_MARKET_INDEX ||
      transferData?.perp_market_index !== plan.marketIndex ||
      bnString(transferData?.amount) !== plan.isolatedCollateralBaseUnits.toString()
    ) {
      throw new VelocityOrderVerificationError();
    }
  }
}

function bn(value: bigint): BN {
  const Constructor = BN as unknown as { new (input: string): BN };
  return new Constructor(value.toString());
}

function bnString(value: unknown): string | null {
  return typeof value === 'object' && value !== null && 'toString' in value
    ? (value as { toString(): string }).toString()
    : null;
}

function sameKeys(actual: readonly AccountMeta[], expected: readonly AccountMeta[]): boolean {
  return actual.length === expected.length && actual.every((entry, index) => {
    const target = expected[index];
    return target !== undefined && entry.pubkey.equals(target.pubkey) &&
      entry.isSigner === target.isSigner && entry.isWritable === target.isWritable;
  });
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
