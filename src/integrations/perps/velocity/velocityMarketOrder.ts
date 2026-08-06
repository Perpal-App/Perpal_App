import { base64 } from '@scure/base';
import { calculateFormattedLiveFundingRate } from '@velocity-exchange/sdk/lib/browser/math/funding';
import { calculateAskPrice, calculateBidPrice } from '@velocity-exchange/sdk/lib/browser/math/market';
import { standardizePrice } from '@velocity-exchange/sdk/lib/browser/math/orders';
import { calculateTradeSlippage, getUser30dRollingVolumeEstimate } from '@velocity-exchange/sdk/lib/browser/math/trade';
import type { MMOraclePriceData } from '@velocity-exchange/sdk/lib/browser/oracles/types';
import {
  PositionDirection,
  type PerpMarketAccount,
  type StateAccount,
  type UserAccount,
  type UserStatsAccount,
} from '@velocity-exchange/sdk/lib/browser/types';
import * as Crypto from 'expo-crypto';
import { PublicKey, Transaction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { signedSolanaRpc } from '@/integrations/api/signedSolanaRpc';
import {
  fetchPublicMarketPrices,
  type PublicMarketSymbol,
} from '@/integrations/perps/markets/publicMarketData';
import {
  buildVelocityMarketOrderTransaction,
  verifyVelocityMarketOrderPlan,
  type VelocityMarketOrderTransactionPlan,
  type VelocityOrderSide,
} from '@/integrations/perps/velocity/velocityMarketOrderTransaction';
import {
  buildVelocityOrderRemainingAccounts,
  loadVelocityOrderState,
  VelocityMarketOrderError,
} from '@/integrations/perps/velocity/velocityMarketOrderState';
import { createReadOnlyVelocityUser } from '@/integrations/perps/velocity/velocityPortfolio';
import {
  queueVelocitySettlement,
  resumeVelocitySettlements,
} from '@/integrations/perps/velocity/velocitySettlement';
import {
  signAndSubmitLegacyTransaction,
  type SubmittedTransactionResult,
} from '@/integrations/solana/signedLegacyTransaction';

const SLIPPAGE_BPS = 50;
const PLAN_LIFETIME_MS = 45_000;
const VOLUME_THRESHOLDS = [2_000_000n, 10_000_000n, 20_000_000n, 80_000_000n, 200_000_000n]
  .map((value) => value * 1_000_000n);
export { VelocityMarketOrderError };

export type VelocityMarketOrderPlan = VelocityMarketOrderTransactionPlan & {
  readonly symbol: PublicMarketSymbol;
  readonly estimatedEntryPrice: bigint;
  readonly notionalBaseUnits: bigint;
  readonly requiredMarginBaseUnits: bigint;
  readonly takerFeeBaseUnits: bigint;
  readonly totalCollateralBaseUnits: bigint;
  readonly freeCollateralBaseUnits: bigint;
  readonly liquidationPrice: bigint | null;
  readonly fundingLabel: string;
  readonly slippageBps: number;
  readonly feeLamports: bigint;
  readonly solBalanceLamports: bigint;
  readonly simulation: 'passed' | 'insufficient-sol';
  readonly quotePublishedAtMs: number;
  readonly expiresAtMs: number;
  readonly idempotencyKey: string;
  readonly closesPosition: boolean;
};

type OrderInput = {
  readonly baseAssetAmount: bigint;
  readonly marketDataUrl: string;
  readonly owner: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly reduceOnly: boolean;
  readonly side: VelocityOrderSide;
  readonly signer: GatewayRequestSigner;
  readonly symbol: PublicMarketSymbol;
  readonly signal?: AbortSignal;
};

type ContextValue<T> = { readonly context: { readonly slot: number }; readonly value: T };

export async function prepareVelocityMarketOrder(input: OrderInput): Promise<VelocityMarketOrderPlan> {
  if (input.baseAssetAmount <= 0n) {
    throw new VelocityMarketOrderError('Enter a position size greater than zero.', 'size_invalid');
  }

  assertSigner(input.owner, input.signer);
  const requestSignal = input.signal ?? new AbortController().signal;
  const [orderState, blockhash, solBalance, prices] = await Promise.all([
    loadVelocityOrderState(input),
    signedSolanaRpc<ContextValue<{ readonly blockhash: string; readonly lastValidBlockHeight: number }>>({
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    signedSolanaRpc<ContextValue<number>>({
      method: 'getBalance',
      params: [input.owner, { commitment: 'confirmed' }],
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    fetchPublicMarketPrices(input.marketDataUrl, requestSignal),
  ]);
  const { addresses } = orderState;
  const state = orderState;
  const price = prices.find((candidate) => candidate.symbol === input.symbol);

  if (price === undefined || price.stale) {
    throw new VelocityMarketOrderError('The Pyth execution reference is stale.', 'quote_stale');
  }

  validateSize(input.baseAssetAmount, state.perpMarket);
  const closesPosition = validatePositionChange(
    state.user,
    state.addresses.marketIndex,
    input,
  );
  const oracle = oracleData(state.perpMarket, price.price.baseUnits, price.price.decimals, orderState.slot);
  const direction = input.side === 'long' ? PositionDirection.LONG : PositionDirection.SHORT;
  const size = velocityBn(state.perpMarket, input.baseAssetAmount);
  const latestSlot = velocityBn(state.perpMarket, BigInt(orderState.slot));
  const [, , estimatedEntry, newPrice] = calculateTradeSlippage(
    direction,
    size,
    state.perpMarket,
    'base',
    oracle,
    true,
    latestSlot,
  );
  const startPrice = input.side === 'long'
    ? calculateAskPrice(state.perpMarket, oracle, latestSlot)
    : calculateBidPrice(state.perpMarket, oracle, latestSlot);
  const limitPrice = priceWithSlippage(
    BigInt(newPrice.toString()),
    BigInt(state.perpMarket.orderTickSize.toString()),
    input.side,
  );
  const standardizedStart = standardizePrice(
    startPrice,
    state.perpMarket.orderTickSize,
    direction,
  );
  const notional = ceilDiv(input.baseAssetAmount * limitPrice, 1_000_000_000n);
  const requiredMargin = input.reduceOnly
    ? 0n
    : ceilDiv(
        notional * BigInt(state.perpMarket.marginRatioInitial),
        10_000n,
      );
  const takerFee = calculateTakerFee(notional, state.state, state.stats, state.perpMarket);
  const marketAccounts = new Map(
    state.perpMarkets.map((market) => [market.marketIndex, market]),
  );
  const oracleAccounts = new Map<number, MMOraclePriceData>();

  for (const market of state.perpMarkets) {
    const marketPrice = prices.find(
      (candidate) => candidate.symbol === symbolForMarketIndex(market.marketIndex),
    );
    if (marketPrice === undefined || marketPrice.stale) {
      throw new VelocityMarketOrderError(
        'A price required for account-wide risk is unavailable.',
        'risk_price_unavailable',
      );
    }
    oracleAccounts.set(
      market.marketIndex,
      oracleData(
        market,
        marketPrice.price.baseUnits,
        marketPrice.price.decimals,
        orderState.slot,
      ),
    );
  }
  const riskUser = createReadOnlyVelocityUser(
    new PublicKey(addresses.userAccount),
    state.user,
    orderState.slot,
    marketAccounts,
    state.spotMarket,
    oracleAccounts,
    state.state,
  );
  const initialRisk = riskUser.getMarginCalculation('Initial');
  const totalCollateral = BigInt(initialRisk.totalCollateral.toString());
  const freeCollateral = BigInt(riskUser.getFreeCollateral('Initial').toString());

  if (!input.reduceOnly && freeCollateral < requiredMargin + takerFee) {
    throw new VelocityMarketOrderError(
      'Velocity collateral is insufficient for this size, margin, and fee.',
      'insufficient_collateral',
    );
  }

  const signedSize = velocityBn(
    state.perpMarket,
    input.side === 'long' ? input.baseAssetAmount : -input.baseAssetAmount,
  );
  const liquidation = riskUser.liquidationPrice(
    addresses.marketIndex,
    signedSize,
    velocityBn(state.perpMarket, limitPrice),
    'Maintenance',
    true,
  );

  const remainingAccounts = buildVelocityOrderRemainingAccounts(orderState);
  const isolatedCollateralBaseUnits = input.reduceOnly
    ? 0n
    : requiredMargin + takerFee;
  const orderExpiryUnixSeconds = BigInt(Math.floor(Date.now() / 1_000) + 45);
  const transaction = buildVelocityMarketOrderTransaction({
    owner: input.owner,
    stateAccount: addresses.stateAccount,
    userAccount: addresses.userAccount,
    userStatsAccount: addresses.userStatsAccount,
    spotMarketVault: state.spotMarket.vault.toBase58(),
    remainingAccounts,
    marketIndex: addresses.marketIndex,
    side: input.side,
    reduceOnly: input.reduceOnly,
    isolatedCollateralBaseUnits,
    baseAssetAmount: input.baseAssetAmount,
    limitPrice,
    auctionStartPrice: BigInt(standardizedStart.toString()),
    auctionDurationSlots: validateAuctionDuration(state.state.minPerpAuctionDuration),
    orderExpiryUnixSeconds,
    programId: input.programId,
    recentBlockhash: blockhash.value.blockhash,
  });
  const fee = await signedSolanaRpc<ContextValue<number | null>>({
    method: 'getFeeForMessage',
    params: [base64.encode(transaction.serializeMessage()), { commitment: 'confirmed' }],
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (fee.value === null) {
    throw new VelocityMarketOrderError('The network fee could not be calculated.', 'fee_unavailable');
  }

  const feeLamports = safeInteger(fee.value, 'network fee');
  const solBalanceLamports = safeInteger(solBalance.value, 'SOL balance');
  const simulation = solBalanceLamports < feeLamports
    ? 'insufficient-sol'
    : await simulateOrder(transaction, input.rpcUrl, input.signer, input.signal);
  const plan: VelocityMarketOrderPlan = {
    owner: input.owner,
    stateAccount: addresses.stateAccount,
    userAccount: addresses.userAccount,
    userStatsAccount: addresses.userStatsAccount,
    spotMarketVault: state.spotMarket.vault.toBase58(),
    remainingAccounts,
    marketIndex: addresses.marketIndex,
    side: input.side,
    reduceOnly: input.reduceOnly,
    isolatedCollateralBaseUnits,
    baseAssetAmount: input.baseAssetAmount,
    limitPrice,
    auctionStartPrice: BigInt(standardizedStart.toString()),
    auctionDurationSlots: validateAuctionDuration(state.state.minPerpAuctionDuration),
    orderExpiryUnixSeconds,
    unsignedTransaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
    recentBlockhash: blockhash.value.blockhash,
    symbol: input.symbol,
    estimatedEntryPrice: BigInt(estimatedEntry.toString()),
    notionalBaseUnits: notional,
    requiredMarginBaseUnits: requiredMargin,
    takerFeeBaseUnits: takerFee,
    totalCollateralBaseUnits: totalCollateral,
    freeCollateralBaseUnits: freeCollateral,
    liquidationPrice:
      BigInt(liquidation.toString()) < 0n
        ? null
        : BigInt(liquidation.toString()),
    fundingLabel: fundingLabel(state.perpMarket, oracle),
    slippageBps: SLIPPAGE_BPS,
    feeLamports,
    solBalanceLamports,
    simulation,
    quotePublishedAtMs: price.publishedAtMs,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    idempotencyKey: Crypto.randomUUID(),
    closesPosition,
  };

  verifyVelocityMarketOrderPlan(plan, input.programId);
  return plan;
}

export async function submitVelocityMarketOrder(
  input: OrderInput & {
    readonly intentStartedAtMs: number;
    readonly plan: VelocityMarketOrderPlan;
  },
): Promise<SubmittedTransactionResult> {
  verifyVelocityMarketOrderPlan(input.plan, input.programId);

  if (
    input.plan.owner !== input.owner ||
    input.plan.symbol !== input.symbol ||
    input.plan.side !== input.side ||
    input.plan.reduceOnly !== input.reduceOnly ||
    input.plan.baseAssetAmount !== input.baseAssetAmount ||
    input.plan.simulation !== 'passed' ||
    Date.now() >= input.plan.expiresAtMs
  ) {
    throw new VelocityMarketOrderError('The confirmed order expired. Prepare it again.', 'plan_expired');
  }

  const current = await prepareVelocityMarketOrder(input);
  const movedPastLimit = input.side === 'long'
    ? current.limitPrice > input.plan.limitPrice
    : current.limitPrice < input.plan.limitPrice;

  if (
    movedPastLimit ||
    current.requiredMarginBaseUnits > input.plan.requiredMarginBaseUnits ||
    current.takerFeeBaseUnits > input.plan.takerFeeBaseUnits ||
    current.isolatedCollateralBaseUnits > input.plan.isolatedCollateralBaseUnits ||
    current.totalCollateralBaseUnits < input.plan.totalCollateralBaseUnits
  ) {
    throw new VelocityMarketOrderError('Price or account risk changed. Review a new order quote.', 'quote_changed');
  }

  const result = await signAndSubmitLegacyTransaction({
    idempotencyKey: input.plan.idempotencyKey,
    owner: input.owner,
    rpcUrl: input.rpcUrl,
    signer: input.signer,
    tradeTiming: {
      action: input.plan.closesPosition
        ? 'close'
        : input.plan.reduceOnly
          ? 'reduce'
          : 'open',
      intentStartedAtMs: input.intentStartedAtMs,
      provider: 'velocity',
    },
    unsignedTransaction: input.plan.unsignedTransaction,
    ...(input.plan.closesPosition
      ? {
          onSigned: async (signature: string) => {
            await queueVelocitySettlement({
              closeSignature: signature,
              marketIndex: input.plan.marketIndex,
              owner: input.owner,
              symbol: input.symbol,
            });
          },
        }
      : {}),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (input.plan.closesPosition && result.status === 'confirmed') {
    await resumeVelocitySettlements({
      marketDataUrl: input.marketDataUrl,
      owner: input.owner,
      programId: input.programId,
      rpcUrl: input.rpcUrl,
      signer: input.signer,
    });
  }
  return result;
}

function oracleData(market: PerpMarketAccount, baseUnits: bigint, decimals: number, slot: number): MMOraclePriceData {
  const price = decimals === 6 ? baseUnits : baseUnits / 10n ** BigInt(decimals - 6);
  return {
    price: velocityBn(market, price),
    confidence: velocityBn(market, 1n),
    slot: velocityBn(market, BigInt(slot)),
    hasSufficientNumberOfDataPoints: true,
    isMMOracleActive: BigInt(market.marketStats.mmOracleSlot.toString()) !== 0n,
  };
}

function calculateTakerFee(
  notional: bigint,
  state: StateAccount,
  stats: UserStatsAccount,
  market: PerpMarketAccount,
): bigint {
  const rollingVolume = BigInt(getUser30dRollingVolumeEstimate(stats).toString());
  const tierIndex = VOLUME_THRESHOLDS.findIndex((threshold) => rollingVolume < threshold);
  const tier = state.perpFeeStructure.feeTiers[tierIndex < 0 ? 5 : tierIndex];
  if (tier === undefined || tier.feeDenominator <= 0 || market.feeAdjustment <= -100) {
    throw new VelocityMarketOrderError('Velocity returned an invalid fee schedule.', 'fee_invalid');
  }
  return ceilDiv(
    notional * BigInt(tier.feeNumerator) * BigInt(100 + market.feeAdjustment),
    BigInt(tier.feeDenominator) * 100n,
  );
}

function priceWithSlippage(price: bigint, tick: bigint, side: VelocityOrderSide): bigint {
  const raw = side === 'long'
    ? ceilDiv(price * BigInt(10_000 + SLIPPAGE_BPS), 10_000n)
    : (price * BigInt(10_000 - SLIPPAGE_BPS)) / 10_000n;
  if (tick <= 0n) return raw;
  const remainder = raw % tick;
  return remainder === 0n ? raw : side === 'long' ? raw - remainder : raw + tick - remainder;
}

function validateSize(amount: bigint, market: PerpMarketAccount): void {
  const step = BigInt(market.orderStepSize.toString());
  const minimum = BigInt(market.marketStats.minOrderSize.toString());
  if (step <= 0n || amount < minimum || amount % step !== 0n) {
    throw new VelocityMarketOrderError(
      `Size must be at least ${minimum.toString()} base units and align to the Velocity step size.`,
      'size_step_invalid',
    );
  }
}

function validatePositionChange(
  user: UserAccount,
  marketIndex: number,
  input: Pick<OrderInput, 'baseAssetAmount' | 'reduceOnly' | 'side'>,
): boolean {
  const position = user.perpPositions.find(
    (candidate) => candidate.marketIndex === marketIndex,
  );
  const currentBase = position === undefined
    ? 0n
    : BigInt(position.baseAssetAmount.toString());
  const currentQuote = position === undefined
    ? 0n
    : BigInt(position.quoteAssetAmount.toString());

  if (!input.reduceOnly) {
    if (currentBase !== 0n || currentQuote !== 0n) {
      throw new VelocityMarketOrderError(
        'Use reduce-only to close the existing position before opening another.',
        'existing_position',
      );
    }
    return false;
  }

  const closesPosition =
    (currentBase > 0n && input.side === 'short') ||
    (currentBase < 0n && input.side === 'long');

  if (!closesPosition || input.baseAssetAmount > abs(currentBase)) {
    throw new VelocityMarketOrderError(
      'Reduce-only size and side must close the selected position without reversing it.',
      'reduce_only_invalid',
    );
  }

  if (
    position === undefined ||
    BigInt(position.isolatedPositionScaledBalance.toString()) <= 0n
  ) {
    throw new VelocityMarketOrderError(
      'This position is not isolated and cannot use the automatic settlement path.',
      'position_not_isolated',
    );
  }
  return input.baseAssetAmount === abs(currentBase);
}

function symbolForMarketIndex(marketIndex: number): PublicMarketSymbol {
  const symbol = ['BTC-PERP', 'ETH-PERP', 'SOL-PERP'][marketIndex];
  if (symbol === undefined) {
    throw new VelocityMarketOrderError(
      'A non-core Velocity position cannot be priced.',
      'account_shape_unsupported',
    );
  }
  return symbol as PublicMarketSymbol;
}

function validateAuctionDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 255) {
    throw new VelocityMarketOrderError('Velocity returned an invalid auction duration.', 'auction_invalid');
  }
  return value;
}

function fundingLabel(market: PerpMarketAccount, oracle: MMOraclePriceData): string {
  try {
    const rate = calculateFormattedLiveFundingRate(market, oracle, oracle, 'hour').longRate;
    return rate === 0 ? '0.00000% / hour' : `Longs ${rate < 0 ? 'pay' : 'receive'} ${Math.abs(rate).toFixed(5)}% / hour`;
  } catch {
    return 'Unavailable';
  }
}

async function simulateOrder(
  transaction: Transaction,
  rpcUrl: string,
  signer: GatewayRequestSigner,
  signal?: AbortSignal,
): Promise<'passed'> {
  const result = await signedSolanaRpc<ContextValue<{ readonly err: unknown }>>({
    method: 'simulateTransaction',
    params: [base64.encode(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })),
      { commitment: 'confirmed', encoding: 'base64', replaceRecentBlockhash: false, sigVerify: false }],
    rpcUrl,
    signer,
    timeoutMs: 12_000,
    ...(signal === undefined ? {} : { signal }),
  });
  if (result.value.err !== null) {
    throw new VelocityMarketOrderError('Velocity rejected the order preview.', 'simulation_failed');
  }
  return 'passed';
}

function assertSigner(owner: string, signer: GatewayRequestSigner): void {
  if (!new PublicKey(signer.publicKey).equals(new PublicKey(owner))) {
    throw new VelocityMarketOrderError('Trading wallet T does not match the active signer.', 'signer_mismatch');
  }
}

function velocityBn(market: PerpMarketAccount, value: bigint) {
  const Constructor = market.amm.pegMultiplier.constructor as unknown as new (input: string) => PerpMarketAccount['amm']['pegMultiplier'];
  return new Constructor(value.toString());
}

function safeInteger(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new VelocityMarketOrderError(`The ${label} is invalid.`, 'rpc_value_invalid');
  }
  return BigInt(value);
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
