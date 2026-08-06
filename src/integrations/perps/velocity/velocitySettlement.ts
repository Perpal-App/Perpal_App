import { base64 } from '@scure/base';
import { CustomBorshCoder } from '@velocity-exchange/sdk/lib/browser/decode/customCoder';
import velocityIdl from '@velocity-exchange/sdk/lib/browser/idl/velocity.json';
import { BN } from '@velocity-exchange/sdk/lib/browser/isomorphic/anchor';
import { getTokenAmount } from '@velocity-exchange/sdk/lib/browser/math/spotBalance';
import { calculateClaimablePnl } from '@velocity-exchange/sdk/lib/browser/math/position';
import {
  getVelocitySignerPublicKey,
} from '@velocity-exchange/sdk/lib/browser/addresses/pda';
import { SpotBalanceType } from '@velocity-exchange/sdk/lib/browser/types';
import * as Crypto from 'expo-crypto';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  fetchPublicMarketPrices,
  type PublicMarketSymbol,
} from '@/integrations/perps/markets/publicMarketData';
import {
  buildVelocityOrderRemainingAccounts,
  loadVelocityOrderState,
  VelocityMarketOrderError,
} from '@/integrations/perps/velocity/velocityMarketOrderState';
import {
  readPendingVelocitySettlements,
  removePendingVelocitySettlement,
  writePendingVelocitySettlement,
  type PendingVelocitySettlement,
} from '@/integrations/perps/velocity/velocitySettlementStorage';
import {
  readSubmittedTransactionStatus,
  signAndSubmitLegacyTransaction,
} from '@/integrations/solana/signedLegacyTransaction';

const QUOTE_MARKET_INDEX = 0;
const COMPUTE_UNIT_LIMIT = 500_000;
const SETTLEMENT_POLL_ATTEMPTS = 60;
const SETTLEMENT_POLL_MS = 2_000;
const coder = new CustomBorshCoder(
  velocityIdl as unknown as ConstructorParameters<typeof CustomBorshCoder>[0],
);

type ResumeInput = {
  readonly owner: string;
  readonly marketDataUrl: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
};

export async function queueVelocitySettlement(input: {
  readonly closeSignature: string;
  readonly marketIndex: number;
  readonly owner: string;
  readonly symbol: PublicMarketSymbol;
}): Promise<void> {
  await writePendingVelocitySettlement({
    ...input,
    errorCode: null,
    settlementSignature: null,
    updatedAtMs: Date.now(),
  });
}

export async function resumeVelocitySettlements(input: ResumeInput): Promise<void> {
  for (let attempt = 0; attempt < SETTLEMENT_POLL_ATTEMPTS; attempt += 1) {
    const records = await readPendingVelocitySettlements(input.owner);
    if (records.length === 0) return;
    await Promise.all(records.map(async (record) => {
      try {
        await resumeOne(record, input);
      } catch (cause) {
        const latest = (await readPendingVelocitySettlements(input.owner)).find(
          (candidate) => candidate.marketIndex === record.marketIndex,
        );
        if (latest !== undefined) {
          await writePendingVelocitySettlement({
            ...latest,
            errorCode: cause instanceof VelocityMarketOrderError
              ? cause.code
              : 'settlement_failed',
            updatedAtMs: Date.now(),
          });
        }
      }
    }));
    const pending = await readPendingVelocitySettlements(input.owner);
    if (pending.length === 0 || pending.every((record) => record.errorCode !== null)) return;
    await delay(SETTLEMENT_POLL_MS);
  }
}

async function resumeOne(
  record: PendingVelocitySettlement,
  input: ResumeInput,
): Promise<void> {
  const closeStatus = await readSubmittedTransactionStatus({
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    signature: record.closeSignature,
  });
  if (closeStatus === 'failed') {
    await removePendingVelocitySettlement(record.owner, record.marketIndex);
    return;
  }
  if (closeStatus !== 'confirmed') return;

  if (record.settlementSignature !== null) {
    const status = await readSubmittedTransactionStatus({
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      signature: record.settlementSignature,
    });
    if (status === 'confirmed') {
      await removePendingVelocitySettlement(record.owner, record.marketIndex);
    }
    if (status === 'failed') {
      throw new VelocityMarketOrderError(
        'Velocity collateral settlement failed on-chain.',
        'settlement_failed',
      );
    }
    return;
  }

  const plan = await prepareSettlement({ ...input, symbol: record.symbol });
  if (plan === null) {
    await removePendingVelocitySettlement(record.owner, record.marketIndex);
    return;
  }
  const result = await signAndSubmitLegacyTransaction({
    idempotencyKey: Crypto.randomUUID(),
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    unsignedTransaction: plan.unsignedTransaction,
    onSigned: async (signature) => {
      await writePendingVelocitySettlement({
        ...record,
        errorCode: null,
        settlementSignature: signature,
        updatedAtMs: Date.now(),
      });
    },
  });
  if (result.status === 'confirmed') {
    await removePendingVelocitySettlement(record.owner, record.marketIndex);
  }
}

async function prepareSettlement(
  input: ResumeInput & { readonly symbol: PublicMarketSymbol },
): Promise<{ readonly unsignedTransaction: Uint8Array } | null> {
  const [state, prices] = await Promise.all([
    loadVelocityOrderState(input),
    fetchPublicMarketPrices(input.marketDataUrl, new AbortController().signal),
  ]);
  const position = state.user.perpPositions.find(
    (candidate) => candidate.marketIndex === state.addresses.marketIndex,
  );
  if (position === undefined) return null;
  if (BigInt(position.baseAssetAmount.toString()) !== 0n || position.openOrders > 0) {
    throw new VelocityMarketOrderError(
      'The selected Velocity position is still open.',
      'position_still_open',
    );
  }

  const deposit = BigInt(
    getTokenAmount(
      position.isolatedPositionScaledBalance,
      state.spotMarket,
      SpotBalanceType.DEPOSIT,
    ).toString(),
  );
  const price = prices.find((candidate) => candidate.symbol === input.symbol);
  if (price === undefined || price.stale) {
    throw new VelocityMarketOrderError(
      'The price required to settle Velocity PnL is unavailable.',
      'settlement_price_unavailable',
    );
  }
  const oraclePrice = price.price.decimals === 6
    ? price.price.baseUnits
    : price.price.baseUnits / 10n ** BigInt(price.price.decimals - 6);
  const claimablePnl = BigInt(
    calculateClaimablePnl(
      state.perpMarket,
      state.spotMarket,
      position,
      { price: bn(oraclePrice) },
    ).toString(),
  );
  const withdrawable = deposit + claimablePnl;
  if (withdrawable <= 0n) return null;

  const blockhash = await signedSolanaRpc<{
    readonly context: { readonly slot: number };
    readonly value: { readonly blockhash: string };
  }>({
    method: 'getLatestBlockhash',
    params: [{ commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
  });
  const remaining = buildVelocityOrderRemainingAccounts(state).map((account) => ({
    pubkey: new PublicKey(account.address),
    isSigner: false,
    isWritable: account.writable,
  }));
  const transaction = buildSettlementTransaction({
    amountBaseUnits: withdrawable,
    marketIndex: state.addresses.marketIndex,
    owner: input.owner,
    programId: input.programId,
    recentBlockhash: blockhash.value.blockhash,
    remaining,
    settlePnl: claimablePnl > 0n,
    spotMarketVault: state.spotMarket.vault.toBase58(),
    stateAccount: state.addresses.stateAccount,
    userAccount: state.addresses.userAccount,
    userStatsAccount: state.addresses.userStatsAccount,
    mint: state.spotMarket.mint.toBase58(),
  });
  await simulate(transaction, input);
  return {
    unsignedTransaction: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  };
}

function buildSettlementTransaction(input: {
  readonly amountBaseUnits: bigint;
  readonly marketIndex: number;
  readonly mint: string;
  readonly owner: string;
  readonly programId: string;
  readonly recentBlockhash: string;
  readonly remaining: readonly AccountMeta[];
  readonly settlePnl: boolean;
  readonly spotMarketVault: string;
  readonly stateAccount: string;
  readonly userAccount: string;
  readonly userStatsAccount: string;
}): Transaction {
  const owner = new PublicKey(input.owner);
  const program = new PublicKey(input.programId);
  const transaction = new Transaction({
    feePayer: owner,
    recentBlockhash: input.recentBlockhash,
  }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }));

  if (input.settlePnl) {
    transaction.add(new TransactionInstruction({
      programId: program,
      keys: [
        ro(new PublicKey(input.stateAccount)),
        rw(new PublicKey(input.userAccount)),
        signer(owner),
        ro(new PublicKey(input.spotMarketVault)),
        ...input.remaining,
      ],
      data: coder.instruction.encode('settle_multiple_pnls', {
        market_indexes: [input.marketIndex],
        mode: { trySettle: {} },
      }),
    }));
  }

  return transaction.add(
    new TransactionInstruction({
      programId: program,
      keys: [
        ro(new PublicKey(input.stateAccount)),
        rw(new PublicKey(input.userAccount)),
        rw(new PublicKey(input.userStatsAccount)),
        signer(owner),
        rw(new PublicKey(input.spotMarketVault)),
        ro(getVelocitySignerPublicKey(program)),
        rw(getAssociatedTokenAddressSync(new PublicKey(input.mint), owner)),
        ro(TOKEN_PROGRAM_ID),
        ...input.remaining,
      ],
      data: coder.instruction.encode('withdraw_from_isolated_perp_position', {
        spot_market_index: QUOTE_MARKET_INDEX,
        perp_market_index: input.marketIndex,
        amount: bn(input.amountBaseUnits),
      }),
    }),
  );
}

async function simulate(transaction: Transaction, input: ResumeInput): Promise<void> {
  const result = await signedSolanaRpc<{
    readonly context: { readonly slot: number };
    readonly value: { readonly err: unknown };
  }>({
    method: 'simulateTransaction',
    params: [
      base64.encode(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
      { commitment: 'confirmed', encoding: 'base64', sigVerify: false },
    ],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    timeoutMs: 12_000,
  });
  if (result.value.err !== null) {
    throw new VelocityMarketOrderError(
      'Velocity rejected automatic isolated-collateral settlement.',
      'settlement_simulation_failed',
    );
  }
}

function bn(value: bigint): BN {
  const Constructor = BN as unknown as { new (input: string): BN };
  return new Constructor(value.toString());
}
function ro(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: false };
}
function rw(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: false, isWritable: true };
}
function signer(pubkey: PublicKey): AccountMeta {
  return { pubkey, isSigner: true, isWritable: true };
}
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
