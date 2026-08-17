import * as Crypto from 'expo-crypto';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  pacificaGet,
  pacificaPostSigned,
} from '@/integrations/perps/pacifica/pacificaApi';
import {
  parsePacificaPrices,
  type PacificaMarket,
  type PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { logTradeTiming } from '@/integrations/observability/tradeTiming';

const SIZE_DECIMALS = 10;
const PLAN_LIFETIME_MS = 5_000;
const SLIPPAGE_PERCENT = '0.5';

export type PacificaOrderAction = 'open' | 'close';
export type PacificaOrderSide = 'long' | 'short';
export type PacificaMarginMode = 'isolated' | 'cross';

export type PacificaTriggerOrder = {
  readonly clientOrderId: string;
  readonly stopPrice: string;
};

export type PacificaMarketOrderPlan = {
  readonly action: PacificaOrderAction;
  readonly amount: string;
  readonly clientOrderId: string;
  readonly collateralBaseUnits: bigint;
  readonly estimatedFeeBaseUnits: bigint;
  readonly expiresAtMs: number;
  readonly leverage: number;
  readonly marginMode: PacificaMarginMode;
  readonly markPrice: string;
  readonly notionalBaseUnits: bigint;
  readonly reduceOnly: boolean;
  readonly side: PacificaOrderSide;
  readonly signedSide: 'bid' | 'ask';
  readonly slippagePercent: string;
  readonly symbol: string;
  readonly stopLoss: PacificaTriggerOrder | null;
  readonly takeProfit: PacificaTriggerOrder | null;
};

export async function preparePacificaMarketOrder(input: {
  readonly action: PacificaOrderAction;
  readonly collateralBaseUnits: bigint;
  readonly leverage: number;
  readonly marginMode: PacificaMarginMode;
  readonly market: PacificaMarket;
  readonly portfolio: PacificaPortfolioSnapshot;
  readonly side: PacificaOrderSide;
  readonly snapshot: PacificaMarketSnapshot;
  readonly stopLossPrice?: string;
  readonly takeProfitPrice?: string;
}): Promise<PacificaMarketOrderPlan> {
  if (input.snapshot.priceStale || input.snapshot.venueRef !== input.market.venueRef) {
    throw new Error('Pacifica price is stale. Refresh before preparing the order.');
  }
  const position = input.portfolio.positions.find(
    (candidate) => candidate.symbol === input.market.venueRef && candidate.side === input.side,
  );
  const leverage = input.action === 'open' ? input.leverage : 1;
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > input.market.maxLeverage) {
    throw new Error(`Choose leverage from 1× to ${input.market.maxLeverage}×.`);
  }
  if (input.action === 'close' && position === undefined) {
    throw new Error(`No ${input.side} ${input.market.baseAsset} position is open.`);
  }
  if (input.action === 'open' && input.collateralBaseUnits <= 0n) {
    throw new Error('Enter USDC collateral greater than zero.');
  }
  if (input.action === 'open' && input.market.isolatedOnly && input.marginMode !== 'isolated') {
    throw new Error(`${input.market.baseAsset} supports isolated margin only.`);
  }
  if (input.action === 'close' && (input.takeProfitPrice || input.stopLossPrice)) {
    throw new Error('TP/SL can only be attached when opening a position.');
  }

  const markBaseUnits = input.snapshot.price.baseUnits;
  if (markBaseUnits <= 0n) throw new Error('Pacifica mark price is invalid.');
  const takeProfit = triggerOrder(
    input.takeProfitPrice,
    'Take-profit',
    input.side,
    'take-profit',
    markBaseUnits,
    input.market.tickSize,
    input.snapshot.price.decimals,
  );
  const stopLoss = triggerOrder(
    input.stopLossPrice,
    'Stop-loss',
    input.side,
    'stop-loss',
    markBaseUnits,
    input.market.tickSize,
    input.snapshot.price.decimals,
  );
  const notionalBaseUnits = input.action === 'open'
    ? input.collateralBaseUnits * BigInt(leverage)
    : usdNotional(position!.amount, input.snapshot.price.baseUnits);
  const amountBaseUnits = input.action === 'open'
    ? (notionalBaseUnits * 10n ** 14n) / markBaseUnits
    : parseDecimal(position!.amount, SIZE_DECIMALS);
  const lot = parseDecimal(input.market.lotSize, SIZE_DECIMALS);
  if (lot <= 0n) throw new Error('Pacifica lot size is invalid.');
  const roundedAmount = amountBaseUnits - amountBaseUnits % lot;
  const minimum = parseDecimal(input.market.minOrderSize, SIZE_DECIMALS);
  const maximum = parseDecimal(input.market.maxOrderSize, SIZE_DECIMALS);
  if (roundedAmount < minimum || roundedAmount > maximum) {
    throw new Error('Order size is outside Pacifica market limits.');
  }
  const feeRate = parseRate(input.portfolio.takerFee);

  return {
    action: input.action,
    amount: formatDecimal(roundedAmount, SIZE_DECIMALS),
    clientOrderId: Crypto.randomUUID(),
    collateralBaseUnits: input.collateralBaseUnits,
    estimatedFeeBaseUnits: (notionalBaseUnits * feeRate) / 100_000_000n,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    leverage,
    marginMode: input.action === 'open' ? input.marginMode : position!.marginMode,
    markPrice: formatDecimal(markBaseUnits, input.snapshot.price.decimals),
    notionalBaseUnits,
    reduceOnly: input.action === 'close',
    side: input.side,
    signedSide: signedSide(input.action, input.side),
    slippagePercent: SLIPPAGE_PERCENT,
    symbol: input.market.venueRef,
    stopLoss,
    takeProfit,
  };
}

export async function submitPacificaMarketOrder(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly intentStartedAtMs: number;
  readonly plan: PacificaMarketOrderPlan;
  readonly signer: GatewayRequestSigner;
  readonly signal?: AbortSignal;
}): Promise<{ readonly orderId: number }> {
  if (Date.now() >= input.plan.expiresAtMs) {
    throw new Error('Pacifica order preview expired. Review a new quote.');
  }
  const prices = parsePacificaPrices(await pacificaGet<readonly unknown[]>({
    apiOrigin: input.apiOrigin,
    path: '/info/prices',
    signal: input.signal,
  }));
  const latest = prices.find((price) => price.venueRef === input.plan.symbol);
  if (latest === undefined || latest.priceStale || outsideSlippage(input.plan.markPrice, latest)) {
    throw new Error('Pacifica price moved beyond the confirmed slippage limit. Review again.');
  }

  if (input.plan.action === 'open') {
    await pacificaPostSigned<unknown>({
      account: input.account,
      apiOrigin: input.apiOrigin,
      operation: 'update_margin_mode',
      payload: { is_isolated: input.plan.marginMode === 'isolated', symbol: input.plan.symbol },
      signer: input.signer,
      signal: input.signal,
    });
    await pacificaPostSigned<unknown>({
      account: input.account,
      apiOrigin: input.apiOrigin,
      operation: 'update_leverage',
      payload: { leverage: input.plan.leverage, symbol: input.plan.symbol },
      signer: input.signer,
      signal: input.signal,
    });
  }
  const submittedAt = performance.now();
  logTradeTiming(
    { intentStartedAtMs: input.intentStartedAtMs, provider: 'pacifica', action: input.plan.action },
    'intent_to_submission',
    input.intentStartedAtMs,
    'ok',
  );
  const result = await pacificaPostSigned<unknown>({
    account: input.account,
    apiOrigin: input.apiOrigin,
    operation: 'create_market_order',
    payload: {
      amount: input.plan.amount,
      client_order_id: input.plan.clientOrderId,
      reduce_only: input.plan.reduceOnly,
      side: input.plan.signedSide,
      slippage_percent: input.plan.slippagePercent,
      symbol: input.plan.symbol,
      ...(input.plan.stopLoss === null ? {} : {
        stop_loss: {
          client_order_id: input.plan.stopLoss.clientOrderId,
          stop_price: input.plan.stopLoss.stopPrice,
        },
      }),
      ...(input.plan.takeProfit === null ? {} : {
        take_profit: {
          client_order_id: input.plan.takeProfit.clientOrderId,
          stop_price: input.plan.takeProfit.stopPrice,
        },
      }),
    },
    signer: input.signer,
    signal: input.signal,
  });
  logTradeTiming(
    { intentStartedAtMs: input.intentStartedAtMs, provider: 'pacifica', action: input.plan.action },
    'submission_to_acknowledgement',
    submittedAt,
    'ok',
  );
  const response = object(result);
  const orderId = typeof response.order_id === 'string'
    ? Number(response.order_id)
    : response.order_id;
  if (typeof orderId !== 'number' || !Number.isSafeInteger(orderId)) {
    throw new Error('Pacifica returned an invalid order identifier.');
  }
  return { orderId };
}

export async function cancelPacificaOrder(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly orderId: number;
  readonly signer: GatewayRequestSigner;
  readonly symbol: string;
  readonly signal?: AbortSignal;
}): Promise<void> {
  await pacificaPostSigned({
    account: input.account,
    apiOrigin: input.apiOrigin,
    operation: 'cancel_order',
    payload: { order_id: input.orderId, symbol: input.symbol },
    signer: input.signer,
    signal: input.signal,
  });
}

function signedSide(action: PacificaOrderAction, side: PacificaOrderSide): 'bid' | 'ask' {
  if (action === 'open') return side === 'long' ? 'bid' : 'ask';
  return side === 'long' ? 'ask' : 'bid';
}

function triggerOrder(
  value: string | undefined,
  label: string,
  side: PacificaOrderSide,
  kind: 'take-profit' | 'stop-loss',
  mark: bigint,
  tickSize: string,
  decimals: number,
): PacificaTriggerOrder | null {
  if (value === undefined || value.trim().length === 0) return null;
  const price = parseDecimal(value.trim(), decimals);
  const tick = parseDecimal(tickSize, decimals);
  if (price <= 0n || tick <= 0n || price % tick !== 0n) {
    throw new Error(`${label} must be a positive multiple of the ${tickSize} tick size.`);
  }
  const above = kind === 'take-profit' ? side === 'long' : side === 'short';
  if ((above && price <= mark) || (!above && price >= mark)) {
    throw new Error(`${label} must be ${above ? 'above' : 'below'} the current mark.`);
  }
  return { clientOrderId: Crypto.randomUUID(), stopPrice: formatDecimal(price, decimals) };
}

function outsideSlippage(mark: string, latest: PacificaMarketSnapshot): boolean {
  const confirmed = parseDecimal(mark, latest.price.decimals);
  const difference = latest.price.baseUnits > confirmed
    ? latest.price.baseUnits - confirmed
    : confirmed - latest.price.baseUnits;
  return confirmed <= 0n || difference * 10_000n > confirmed * 50n;
}

function usdNotional(amount: string, priceBaseUnits: bigint): bigint {
  return (parseDecimal(amount, SIZE_DECIMALS) * priceBaseUnits) / 10n ** 14n;
}

function parseRate(value: string): bigint {
  const rate = parseDecimal(value, 8);
  if (rate <= 0n) throw new Error('Pacifica fee data is unavailable. Refresh the portfolio.');
  return rate;
}

function parseDecimal(value: string, decimals: number): bigint {
  if (!/^\d+(?:\.\d+)?$/u.test(value)) throw new Error('Pacifica decimal value is invalid.');
  const [whole = '0', fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Pacifica decimal precision is unsupported.');
  return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
}

function formatDecimal(value: bigint, decimals: number): string {
  const digits = value.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/u, '');
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Pacifica returned an invalid order response.');
  }
  return value as Record<string, unknown>;
}
