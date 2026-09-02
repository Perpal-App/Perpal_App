import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { getUserAccountPublicKeySync } from '@velocity-exchange/sdk/lib/browser/addresses/pda';
import { getMarketOrderParams } from '@velocity-exchange/sdk/lib/browser/orderParams';
import { MarketType, PositionDirection } from '@velocity-exchange/sdk/lib/browser/types';
import { VelocityClient } from '@velocity-exchange/sdk/lib/browser/velocityClient';
import { base64 } from '@scure/base';
import * as Crypto from 'expo-crypto';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  scaledInputForMinimumOutput,
} from '@/integrations/perps/tradeCollateralMath';
import { velocityCloseIntent } from '@/integrations/perps/velocity/velocityAccount';
import {
  subscribedVelocityClient,
  velocityBn,
} from '@/integrations/perps/velocity/velocityClient';
import {
  removePendingTradeAction,
  writePendingTradeAction,
  type PendingTradeAction,
} from '@/integrations/perps/tradeActionStorage';
import {
  preparePrivateWalletSwap,
  submitPrivateWalletSwap,
  type PrivateWalletSwapPlan,
} from '@/integrations/solana/privateWalletSwap';
import { readTokenBalance } from '@/integrations/solana/stablecoinSwap';
import type { SubmittedTransactionResult } from '@/integrations/solana/signedLegacyTransaction';
import { signAndSubmitVersionedTransaction } from '@/integrations/solana/signedVersionedTransaction';

const PLAN_LIFETIME_MS = 45_000;
const BASE_PRECISION = 1_000_000_000n;
const QUOTE_MARKET_INDEX = 0;

export type VelocitySide = 'long' | 'short';

export type VelocityTransactionPlan = {
  readonly action: 'setup' | 'collateral' | 'trade' | 'close' | 'withdraw';
  readonly amountBaseUnits: bigint;
  readonly expiresAtMs: number;
  readonly feeLamports: bigint;
  readonly idempotencyKey: string;
  readonly solBalanceLamports: bigint;
  readonly transaction: VersionedTransaction;
};

export type VelocityTradePreparation =
  | { readonly kind: 'conversion'; readonly plan: PrivateWalletSwapPlan }
  | { readonly kind: 'velocity'; readonly plan: VelocityTransactionPlan };

export async function prepareVelocityTrade(input: {
  readonly collateralBaseUnits: bigint;
  readonly leverage: number;
  readonly marketIndex: number;
  readonly owner: string;
  readonly programId: string;
  readonly publicRpcUrl: string;
  readonly rpcUrl: string;
  readonly signal: AbortSignal;
  readonly side: VelocitySide;
  readonly signer: GatewayRequestSigner;
  readonly swapBuildUrl: string;
  readonly usdcMint: string;
  readonly usdtMint: string;
  readonly fundingOnly?: boolean;
}): Promise<VelocityTradePreparation> {
  if (
    input.collateralBaseUnits <= 0n ||
    !Number.isSafeInteger(input.leverage) ||
    input.leverage < 1
  ) {
    throw new Error('Enter valid collateral and leverage.');
  }

  const owner = new PublicKey(input.owner);
  const programId = new PublicKey(input.programId);
  const userPda = getUserAccountPublicKeySync(programId, owner, 0);
  const connection = new Connection(input.publicRpcUrl, 'confirmed');
  const userExists = await connection.getAccountInfo(userPda, 'confirmed') !== null;
  const client = await subscribedVelocityClient({ connection, owner, programId, userExists });

  try {
    const freeCollateral = userExists
      ? positive(BigInt(client.getUser(0).getFreeCollateral().toString()))
      : 0n;
    const shortfall = input.collateralBaseUnits > freeCollateral
      ? input.collateralBaseUnits - freeCollateral
      : 0n;

    if (shortfall > 0n) {
      const usdtBalance = await readTokenBalance({
        mint: input.usdtMint,
        owner: input.owner,
        rpcUrl: input.rpcUrl,
        signal: input.signal,
        signer: input.signer,
      });
      if (usdtBalance < shortfall) {
        return {
          kind: 'conversion',
          plan: await conversionForMinimumOutput(input, shortfall - usdtBalance),
        };
      }

      const tokenAccount = getAssociatedTokenAddressSync(
        new PublicKey(input.usdtMint),
        owner,
      );
      const instructions = userExists
        ? await client.getDepositTxnIx(
            velocityBn(shortfall),
            QUOTE_MARKET_INDEX,
            tokenAccount,
            0,
          )
        : (await client.createInitializeUserAccountAndDepositCollateralIxs(
            velocityBn(shortfall),
            tokenAccount,
            QUOTE_MARKET_INDEX,
            0,
            'Perpal',
          )).ixs;
      return {
        kind: 'velocity',
        plan: await prepareVelocityTransactionPlan({
          action: userExists ? 'collateral' : 'setup',
          amountBaseUnits: shortfall,
          client,
          instructions,
          owner,
          programId,
          rpcUrl: input.rpcUrl,
          signal: input.signal,
          signer: input.signer,
        }),
      };
    }

    if (input.fundingOnly) {
      throw new Error('Velocity already has available trading balance.');
    }
    if (!userExists) throw new Error('Velocity account setup is required before trading.');
    const market = client.getPerpMarketAccountOrThrow(input.marketIndex);
    if (input.leverage > Math.floor(10_000 / market.marginRatioInitial)) {
      throw new Error(`Maximum leverage is ${Math.floor(10_000 / market.marginRatioInitial)}×.`);
    }
    const oracle = client.getMMOracleDataForPerpMarket(input.marketIndex);
    const price = BigInt(oracle.price.toString());
    if (price <= 0n) throw new Error('Velocity price is unavailable.');
    const rawSize = input.collateralBaseUnits * BigInt(input.leverage) * BASE_PRECISION / price;
    const step = BigInt(market.orderStepSize.toString());
    const size = step === 0n ? rawSize : rawSize / step * step;
    const minimum = BigInt(market.marketStats.minOrderSize.toString());
    if (size < minimum || size === 0n) {
      const minimumCollateral = (minimum * price + BASE_PRECISION * BigInt(input.leverage) - 1n) /
        (BASE_PRECISION * BigInt(input.leverage));
      throw new Error(`Minimum required is ${decimal(minimumCollateral)} USDT at ${input.leverage}×.`);
    }

    const order = getMarketOrderParams({
      baseAssetAmount: velocityBn(size),
      direction: input.side === 'long' ? PositionDirection.LONG : PositionDirection.SHORT,
      marketIndex: input.marketIndex,
      marketType: MarketType.PERP,
      reduceOnly: false,
    });
    const instruction = await client.getPlaceAndTakePerpOrderIx(order, undefined, undefined, undefined, 0);
    return {
      kind: 'velocity',
      plan: await prepareVelocityTransactionPlan({
        action: 'trade',
        amountBaseUnits: input.collateralBaseUnits,
        client,
        instructions: [instruction],
        owner,
        programId,
        rpcUrl: input.rpcUrl,
        signal: input.signal,
        signer: input.signer,
      }),
    };
  } finally {
    await client.unsubscribe();
  }
}

export async function prepareVelocityClose(input: {
  readonly marketIndex: number;
  readonly owner: string;
  readonly programId: string;
  readonly publicRpcUrl: string;
  readonly rpcUrl: string;
  readonly signal: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<VelocityTradePreparation> {
  const owner = new PublicKey(input.owner);
  const programId = new PublicKey(input.programId);
  const connection = new Connection(input.publicRpcUrl, 'confirmed');
  const userPda = getUserAccountPublicKeySync(programId, owner, 0);
  const userExists = await connection.getAccountInfo(userPda, 'confirmed') !== null;
  if (!userExists) throw new Error('No Velocity account exists for this wallet.');
  const client = await subscribedVelocityClient({ connection, owner, programId, userExists });

  try {
    const position = client.getUser(0).getPerpPosition(input.marketIndex);
    const baseAmount = position === undefined ? 0n : BigInt(position.baseAssetAmount.toString());
    const close = velocityCloseIntent(baseAmount);
    const order = getMarketOrderParams({
      baseAssetAmount: velocityBn(close.amountBaseUnits),
      direction: close.side === 'long' ? PositionDirection.LONG : PositionDirection.SHORT,
      marketIndex: input.marketIndex,
      marketType: MarketType.PERP,
      reduceOnly: true,
    });
    const instruction = await client.getPlaceAndTakePerpOrderIx(
      order,
      undefined,
      undefined,
      undefined,
      0,
    );
    return {
      kind: 'velocity',
      plan: await prepareVelocityTransactionPlan({
        action: 'close',
        amountBaseUnits: close.amountBaseUnits,
        client,
        instructions: [instruction],
        owner,
        programId,
        rpcUrl: input.rpcUrl,
        signal: input.signal,
        signer: input.signer,
      }),
    };
  } finally {
    await client.unsubscribe();
  }
}

export async function submitVelocityTradePreparation(input: {
  readonly owner: string;
  readonly preparation: VelocityTradePreparation;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner;
}): Promise<SubmittedTransactionResult> {
  if (input.preparation.kind === 'conversion') {
    return submitPrivateWalletSwap({
      owner: input.owner,
      plan: input.preparation.plan,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
    });
  }
  const plan = input.preparation.plan;
  if (Date.now() >= plan.expiresAtMs) throw new Error('Trade preparation expired. Review it again.');
  const result = await signAndSubmitVersionedTransaction({
    idempotencyKey: plan.idempotencyKey,
    onSigned: (signature, signedTransactionBase64) => writePendingTradeAction(
      pendingRecord(input.owner, plan, signature, signedTransactionBase64),
    ),
    operationLabel: `Velocity ${plan.action}`,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    transaction: plan.transaction,
  });
  if (result.status === 'confirmed') await removePendingTradeAction(input.owner, 'velocity');
  return result;
}

async function conversionForMinimumOutput(
  input: Parameters<typeof prepareVelocityTrade>[0],
  minimumOutput: bigint,
): Promise<PrivateWalletSwapPlan> {
  let amount = minimumOutput;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const plan = await preparePrivateWalletSwap({
      amountBaseUnits: amount,
      from: 'USDC',
      owner: input.owner,
      rpcUrl: input.rpcUrl,
      signal: input.signal,
      signer: input.signer,
      swapBuildUrl: input.swapBuildUrl,
      usdcMint: input.usdcMint,
      usdtMint: input.usdtMint,
    });
    if (plan.swap.minimumOutputBaseUnits >= minimumOutput) return plan;
    amount = scaledInputForMinimumOutput(
      amount,
      minimumOutput,
      plan.swap.minimumOutputBaseUnits,
    );
  }
  throw new Error('A sufficient USDC to USDT quote is unavailable.');
}

export async function prepareVelocityTransactionPlan(input: {
  readonly action: VelocityTransactionPlan['action'];
  readonly amountBaseUnits: bigint;
  readonly client: VelocityClient;
  readonly instructions: readonly TransactionInstruction[];
  readonly owner: PublicKey;
  readonly programId: PublicKey;
  readonly rpcUrl: string;
  readonly signal: AbortSignal;
  readonly signer: GatewayRequestSigner;
}): Promise<VelocityTransactionPlan> {
  validateInstructions(input.instructions, input.owner, input.programId);
  const transaction = await input.client.buildTransaction(
    [...input.instructions],
    { computeUnits: 600_000, computeUnitsPrice: 5_000 },
    0,
    await input.client.fetchAllLookupTableAccounts(),
    true,
  );
  if (!(transaction instanceof VersionedTransaction)) {
    throw new Error('Velocity returned an unsupported transaction format.');
  }
  const [fee, balance] = await Promise.all([
    signedSolanaRpc<{ readonly value: number | null }>({
      method: 'getFeeForMessage',
      params: [base64.encode(transaction.message.serialize()), { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signal: input.signal,
      signer: input.signer,
    }),
    signedSolanaRpc<{ readonly value: number }>({
      method: 'getBalance',
      params: [input.owner.toBase58(), { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signal: input.signal,
      signer: input.signer,
    }),
  ]);
  if (fee.value === null || !Number.isSafeInteger(fee.value) || !Number.isSafeInteger(balance.value)) {
    throw new Error('Velocity network fee could not be verified.');
  }
  if (balance.value < fee.value) throw new Error('Your private balance needs more SOL for this action.');
  if (input.action === 'setup') {
    const simulation = await signedSolanaRpc<{
      readonly value: {
        readonly accounts: readonly ({ readonly lamports: number } | null)[] | null;
        readonly err: unknown;
        readonly logs: readonly string[] | null;
        readonly postBalances?: readonly number[] | null;
      };
    }>({
      method: 'simulateTransaction',
      params: [
        base64.encode(transaction.serialize()),
        {
          accounts: {
            addresses: [input.owner.toBase58()],
            encoding: 'base64',
          },
          commitment: 'confirmed',
          encoding: 'base64',
          replaceRecentBlockhash: false,
          sigVerify: false,
        },
      ],
      rpcUrl: input.rpcUrl,
      signal: input.signal,
      signer: input.signer,
      timeoutMs: 12_000,
    });
    if (simulation.value.err !== null) {
      const shortfall = velocitySetupSolShortfall(
        simulation.value.logs ?? [],
        BigInt(fee.value),
      );
      if (shortfall !== null) {
        throw new Error(`Add at least ${sol(shortfall)} SOL to your private balance for setup.`);
      }
      const remainingLamports = simulation.value.accounts?.[0]?.lamports ??
        simulation.value.postBalances?.[0];
      if (velocitySetupLeavesWalletBelowRent(simulation.value.err) &&
        remainingLamports !== undefined && Number.isSafeInteger(remainingLamports)) {
        const rentMinimum = await signedSolanaRpc<number>({
          method: 'getMinimumBalanceForRentExemption',
          params: [0, { commitment: 'confirmed' }],
          rpcUrl: input.rpcUrl,
          signal: input.signal,
          signer: input.signer,
        });
        if (Number.isSafeInteger(rentMinimum) && rentMinimum > remainingLamports) {
          throw new Error(
            `Add at least ${sol(BigInt(rentMinimum - remainingLamports))} SOL to your private balance for its rent reserve.`,
          );
        }
      }
      if (velocitySetupLeavesWalletBelowRent(simulation.value.err)) {
        throw new Error('Add SOL to your private balance so it remains rent-exempt after setup.');
      }
      throw new Error('Velocity setup could not be prepared.');
    }
  }
  return {
    action: input.action,
    amountBaseUnits: input.amountBaseUnits,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    feeLamports: BigInt(fee.value),
    idempotencyKey: Crypto.randomUUID(),
    solBalanceLamports: BigInt(balance.value),
    transaction,
  };
}

export function velocitySetupSolShortfall(
  logs: readonly string[],
  feeLamports: bigint,
): bigint | null {
  for (const log of logs) {
    const match = /Transfer: insufficient lamports ([0-9]+), need ([0-9]+)/u.exec(log);
    if (match === null) continue;
    const available = BigInt(match[1]!);
    const required = BigInt(match[2]!) + feeLamports;
    return required > available ? required - available : feeLamports;
  }
  return null;
}

export function velocitySetupLeavesWalletBelowRent(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const rent = (value as Record<string, unknown>).InsufficientFundsForRent;
  return typeof rent === 'object' && rent !== null && !Array.isArray(rent) &&
    (rent as Record<string, unknown>).account_index === 0;
}

function validateInstructions(
  instructions: readonly TransactionInstruction[],
  owner: PublicKey,
  programId: PublicKey,
): void {
  const allowed = [programId, SystemProgram.programId, ComputeBudgetProgram.programId];
  if (
    instructions.length === 0 ||
    !instructions.some((instruction) => instruction.programId.equals(programId)) ||
    instructions.some((instruction) =>
      !allowed.some((program) => program.equals(instruction.programId)) &&
      !instruction.programId.equals(new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')) &&
      !instruction.programId.equals(new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')),
    ) ||
    instructions.some((instruction) =>
      instruction.keys.some((account) => account.isSigner && !account.pubkey.equals(owner)),
    )
  ) {
    throw new Error('Velocity transaction does not match the confirmed wallet intent.');
  }
}

function pendingRecord(
  owner: string,
  plan: VelocityTransactionPlan,
  signature: string,
  signedTransactionBase64: string,
): PendingTradeAction {
  return {
    amountBaseUnits: plan.amountBaseUnits.toString(),
    expiresAtMs: plan.expiresAtMs,
    idempotencyKey: plan.idempotencyKey,
    kind: plan.action,
    owner,
    provider: 'velocity',
    signature,
    signedTransactionBase64,
    updatedAtMs: Date.now(),
    version: 1,
  };
}

function positive(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function decimal(value: bigint): string {
  const digits = value.toString().padStart(7, '0');
  const fraction = digits.slice(-6).replace(/0+$/u, '');
  return fraction.length === 0 ? digits.slice(0, -6) : `${digits.slice(0, -6)}.${fraction}`;
}

function sol(value: bigint): string {
  const digits = value.toString().padStart(10, '0');
  const fraction = digits.slice(-9).replace(/0+$/u, '');
  return fraction.length === 0 ? digits.slice(0, -9) : `${digits.slice(0, -9)}.${fraction}`;
}
