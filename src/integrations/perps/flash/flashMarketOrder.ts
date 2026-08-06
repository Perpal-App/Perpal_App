import { Buffer } from 'buffer';

import { BN } from '@flash_trade/flash-sdk-v2/node_modules/@coral-xyz/anchor';
import { Side, type ContractOraclePrice } from '@flash_trade/flash-sdk-v2/dist/types';
import type { MarketConfig, PoolConfig } from '@flash_trade/flash-sdk-v2/dist/PoolConfig';
import { PublicKey, type TransactionInstruction } from '@solana/web3.js';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { createReadOnlyFlashClient } from '@/integrations/perps/flash/flashClient';
import {
  prepareFlashErTransaction,
  submitFlashErTransaction,
} from '@/integrations/perps/flash/flashErRpc';
import { flashPool } from '@/integrations/perps/flash/flashMarketData';
import { fetchFlashPortfolio } from '@/integrations/perps/flash/flashPortfolio';
import type { PublicMarketSymbol } from '@/integrations/perps/markets/publicMarketData';

const LEVERAGE_SCALE = 10_000n;
const SLIPPAGE_BPS = 50n;
const BPS_SCALE = 10_000n;
const PLAN_LIFETIME_MS = 30_000;

export type FlashOrderSide = 'long' | 'short';
export type FlashOrderAction = 'open' | 'close';

export type FlashMarketOrderPlan = {
  readonly action: FlashOrderAction;
  readonly collateralInputBaseUnits: bigint;
  readonly entryPriceUsdBaseUnits: bigint;
  readonly erFeeLamports: bigint;
  readonly expiresAtMs: number;
  readonly feeUsdBaseUnits: bigint;
  readonly instructionFingerprint: string;
  readonly leverageHundredths: bigint;
  readonly limitPrice: { readonly price: bigint; readonly exponent: number };
  readonly liquidationPriceUsdBaseUnits: bigint | null;
  readonly message: Uint8Array;
  readonly receiveAmountBaseUnits: bigint | null;
  readonly side: FlashOrderSide;
  readonly simulation: 'passed';
  readonly sizeAmountBaseUnits: bigint;
  readonly sizeUsdBaseUnits: bigint;
  readonly symbol: PublicMarketSymbol;
};

type Input = {
  readonly action: FlashOrderAction;
  readonly baseRpcUrl: string;
  readonly collateralInputBaseUnits: bigint;
  readonly erRpcUrl: string;
  readonly leverage: number;
  readonly owner: string;
  readonly programId: string;
  readonly side: FlashOrderSide;
  readonly signer: GatewayRequestSigner;
  readonly symbol: PublicMarketSymbol;
  readonly signal?: AbortSignal;
};

export class FlashMarketOrderError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'FlashMarketOrderError';
  }
}

export async function prepareFlashMarketOrder(input: Input): Promise<FlashMarketOrderPlan> {
  assertInput(input);
  const client = createReadOnlyFlashClient(input);
  const pool = flashPool(input.programId);
  const market = resolveMarket(pool, input.symbol, input.side);
  const targetSymbol = input.symbol.slice(0, -5);
  const lockSymbol = custodySymbol(pool, market.collateralCustody.toBase58());
  const side = input.side === 'long' ? Side.Long : Side.Short;

  let instruction: TransactionInstruction;
  let fields: Omit<
    FlashMarketOrderPlan,
    'erFeeLamports' | 'expiresAtMs' | 'instructionFingerprint' | 'message' | 'simulation'
  >;

  if (input.action === 'open') {
    const quote = await client.views.getOpenPositionQuoteEr(pool, {
      amountIn: bn(input.collateralInputBaseUnits),
      collateralSymbol: lockSymbol,
      leverage: bn(BigInt(input.leverage) * LEVERAGE_SCALE),
      market: market.marketAccount,
      owner: client.wallet,
      receivingSymbol: 'USDC',
      targetSymbol,
    });
    if (!quote.passesMaxPositionSize || !quote.passesMaxExposure || !quote.passesMaxUtilization) {
      throw new FlashMarketOrderError('Flash risk limits reject this position.', 'risk_limit');
    }
    const limitPrice = slippagePrice(quote.entryPrice, input.side, true);
    const result = await client.openPosition(
      targetSymbol,
      lockSymbol,
      'USDC',
      side,
      pool,
      contractPrice(limitPrice),
      quote.collateralAmount,
      quote.sizeAmount,
    );
    instruction = onlyInstruction(result.instructions, result.additionalSigners.length);
    fields = {
      action: input.action,
      collateralInputBaseUnits: input.collateralInputBaseUnits,
      entryPriceUsdBaseUnits: oracleToUsd6(quote.entryPrice),
      feeUsdBaseUnits: BigInt(quote.totalFeeUsd.toString()),
      leverageHundredths: BigInt(quote.finalLeverage.toString()) / 100n,
      limitPrice,
      liquidationPriceUsdBaseUnits: oracleToUsd6(quote.finalLiquidationPrice),
      receiveAmountBaseUnits: null,
      side: input.side,
      sizeAmountBaseUnits: BigInt(quote.sizeAmount.toString()),
      sizeUsdBaseUnits: BigInt(quote.sizeUsd.toString()),
      symbol: input.symbol,
    };
  } else {
    const portfolio = await fetchFlashPortfolio(
      input.erRpcUrl,
      input.programId,
      input.owner,
      input.signal ?? new AbortController().signal,
    );
    const position = portfolio.positions.find(
      (candidate) =>
        candidate.symbol === input.symbol && candidate.side.toLowerCase() === input.side,
    );
    if (position === undefined) {
      throw new FlashMarketOrderError('No matching Flash position is open.', 'position_missing');
    }
    const quote = await client.views.getClosePositionQuoteEr(pool, {
      collateralSymbol: lockSymbol,
      dispensingSymbol: 'USDC',
      market: market.marketAccount,
      owner: client.wallet,
      sizeDeltaUsd: bn(position.sizeUsdBaseUnits),
      targetSymbol,
    });
    const limitPrice = slippagePrice(quote.markPrice, input.side, false);
    const result = await client.closePosition(
      targetSymbol,
      lockSymbol,
      side,
      pool,
      contractPrice(limitPrice),
      'USDC',
    );
    instruction = onlyInstruction(result.instructions, result.additionalSigners.length);
    fields = {
      action: input.action,
      collateralInputBaseUnits: 0n,
      entryPriceUsdBaseUnits: oracleToUsd6(quote.markPrice),
      feeUsdBaseUnits: BigInt(quote.fees.toString()),
      leverageHundredths: 0n,
      limitPrice,
      liquidationPriceUsdBaseUnits: null,
      receiveAmountBaseUnits: BigInt(quote.receiveTokenAmount.toString()),
      side: input.side,
      sizeAmountBaseUnits: BigInt(quote.existingSize.toString()),
      sizeUsdBaseUnits: position.sizeUsdBaseUnits,
      symbol: input.symbol,
    };
  }

  const transaction = await prepareFlashErTransaction({
    erRpcUrl: input.erRpcUrl,
    instructions: [instruction],
    owner: input.owner,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  return {
    ...fields,
    erFeeLamports: transaction.feeLamports,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    instructionFingerprint: fingerprint(instruction),
    message: transaction.message,
    simulation: transaction.simulation,
  };
}

export async function submitFlashMarketOrder(
  input: Input & {
    readonly intentStartedAtMs: number;
    readonly plan: FlashMarketOrderPlan;
    readonly onSigned?: (signature: string) => Promise<void>;
  },
) {
  if (Date.now() > input.plan.expiresAtMs) {
    throw new FlashMarketOrderError('The Flash quote expired. Review a new quote.', 'quote_expired');
  }
  if (
    input.plan.action !== input.action ||
    input.plan.symbol !== input.symbol ||
    input.plan.side !== input.side ||
    input.plan.collateralInputBaseUnits !==
      (input.action === 'open' ? input.collateralInputBaseUnits : 0n)
  ) {
    throw new FlashMarketOrderError('The confirmed Flash order intent changed.', 'intent_mismatch');
  }
  return submitFlashErTransaction({
    erRpcUrl: input.erRpcUrl,
    message: input.plan.message,
    owner: input.owner,
    signer: input.signer,
    tradeTiming: {
      action: input.action,
      intentStartedAtMs: input.intentStartedAtMs,
      provider: 'flash',
    },
    ...(input.onSigned === undefined ? {} : { onSigned: input.onSigned }),
  });
}

function assertInput(input: Input): void {
  if (input.action === 'open' && input.collateralInputBaseUnits <= 0n) {
    throw new FlashMarketOrderError('Enter USDC collateral greater than zero.', 'amount_invalid');
  }
  if (!Number.isSafeInteger(input.leverage) || input.leverage < 1 || input.leverage > 100) {
    throw new FlashMarketOrderError('Choose leverage from 1× to 100×.', 'leverage_invalid');
  }
  if (Buffer.from(input.signer.publicKey).toString('hex') !== Buffer.from(new PublicKey(input.owner).toBytes()).toString('hex')) {
    throw new FlashMarketOrderError('Private wallet T does not match the signer.', 'signer_mismatch');
  }
}

function resolveMarket(pool: PoolConfig, symbol: string, side: FlashOrderSide): MarketConfig {
  const name = `${symbol.slice(0, -5)} ${side === 'long' ? 'Long' : 'Short'}`;
  const market = pool.markets.find((candidate) => candidate.marketNameUi === name);
  if (market === undefined) throw new FlashMarketOrderError('Flash market is unavailable.', 'market_missing');
  return market;
}

function custodySymbol(pool: PoolConfig, address: string): string {
  const custody = pool.custodies.find((candidate) => candidate.custodyAccount.toBase58() === address);
  if (custody === undefined) throw new FlashMarketOrderError('Flash custody is unavailable.', 'custody_missing');
  return custody.symbol;
}

function slippagePrice(
  oracle: { readonly price: { toString(): string }; readonly exponent: number },
  side: FlashOrderSide,
  entry: boolean,
): { readonly price: bigint; readonly exponent: number } {
  const price = BigInt(oracle.price.toString());
  const spread = (price * SLIPPAGE_BPS + BPS_SCALE - 1n) / BPS_SCALE;
  const increase = (entry && side === 'long') || (!entry && side === 'short');
  const adjusted = increase ? price + spread : price > spread ? price - spread : 0n;
  return { price: adjusted, exponent: oracle.exponent };
}

function oracleToUsd6(oracle: { readonly price: { toString(): string }; readonly exponent: number }): bigint {
  const power = oracle.exponent + 6;
  const value = BigInt(oracle.price.toString());
  return power >= 0 ? value * 10n ** BigInt(power) : value / 10n ** BigInt(-power);
}

function contractPrice(price: { readonly price: bigint; readonly exponent: number }): ContractOraclePrice {
  return { price: bn(price.price), exponent: price.exponent };
}

function onlyInstruction(instructions: readonly TransactionInstruction[], signers: number) {
  if (instructions.length !== 1 || signers !== 0 || instructions[0] === undefined) {
    throw new FlashMarketOrderError('Flash returned an unexpected order shape.', 'instruction_shape');
  }
  return instructions[0];
}

function fingerprint(instruction: TransactionInstruction): string {
  return JSON.stringify({
    programId: instruction.programId.toBase58(),
    keys: instruction.keys.map((key) => [key.pubkey.toBase58(), key.isSigner, key.isWritable]),
    data: Buffer.from(instruction.data).toString('base64'),
  });
}

function bn(value: bigint): BN {
  return new BN(value.toString());
}
