import * as Crypto from 'expo-crypto';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import {
  pacificaGet,
  pacificaPostSigned,
  type PacificaOperation,
} from '@/integrations/perps/pacifica/pacificaApi';
import {
  parsePacificaPrices,
  type PacificaMarket,
  type PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  formatDecimal,
  isStopOrder,
  orderPrices,
  parseDecimal,
  PacificaOrderValidationError,
  signedSide,
  validateStopDirection,
  validateTriggerPrice,
  type PacificaOrderAction,
  type PacificaOrderSide,
  type PacificaOrderType,
} from '@/integrations/perps/pacifica/pacificaOrderValidation';
import { logTradeTiming } from '@/integrations/observability/tradeTiming';

export {
  PacificaOrderValidationError,
  validatePacificaOrderDraft,
} from '@/integrations/perps/pacifica/pacificaOrderValidation';
export type {
  PacificaOrderAction,
  PacificaOrderSide,
  PacificaOrderType,
} from '@/integrations/perps/pacifica/pacificaOrderValidation';

const SIZE_DECIMALS = 10;
const PLAN_LIFETIME_MS = 5_000;
const SLIPPAGE_PERCENT = '0.5';

export type PacificaMarginMode = 'isolated' | 'cross';

export type PacificaTriggerOrder = {
  readonly clientOrderId: string;
  readonly stopPrice: string;
};

export type PacificaOrderPlan = {
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
  readonly orderPrice: string | null;
  readonly orderType: PacificaOrderType;
  readonly reduceOnly: boolean;
  readonly side: PacificaOrderSide;
  readonly signedSide: 'bid' | 'ask';
  readonly slippagePercent: string;
  readonly symbol: string;
  readonly triggerPrice: string | null;
  readonly stopLoss: PacificaTriggerOrder | null;
  readonly takeProfit: PacificaTriggerOrder | null;
};

export async function preparePacificaOrder(input: {
  readonly action: PacificaOrderAction;
  readonly collateralBaseUnits: bigint;
  readonly leverage: number;
  readonly marginMode: PacificaMarginMode;
  readonly market: PacificaMarket;
  readonly orderPrice: string | undefined;
  readonly orderType: PacificaOrderType;
  readonly portfolio: PacificaPortfolioSnapshot;
  readonly side: PacificaOrderSide;
  readonly snapshot: PacificaMarketSnapshot;
  readonly stopLossPrice?: string;
  readonly takeProfitPrice?: string;
  readonly triggerPrice: string | undefined;
}): Promise<PacificaOrderPlan> {
  if (input.snapshot.priceStale || input.snapshot.venueRef !== input.market.venueRef) {
    throw new Error('Pacifica price is stale. Refresh before preparing the order.');
  }
  const position = input.portfolio.positions.find(
    (candidate) => candidate.symbol === input.market.venueRef && candidate.side === input.side,
  );
  const leverage = input.action === 'open' ? input.leverage : 1;
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > input.market.maxLeverage) {
    throw new PacificaOrderValidationError(`Choose leverage from 1× to ${input.market.maxLeverage}×.`);
  }
  if (input.action === 'close' && position === undefined) {
    throw new PacificaOrderValidationError(`No ${input.side} ${input.market.baseAsset} position is open.`);
  }
  if (input.action === 'close' && input.orderType !== 'market') {
    throw new PacificaOrderValidationError('Close now uses a reduce-only market order.');
  }
  if (input.action === 'open' && input.collateralBaseUnits <= 0n) {
    throw new PacificaOrderValidationError('Enter collateral greater than zero.');
  }
  if (input.action === 'open' && input.market.isolatedOnly && input.marginMode !== 'isolated') {
    throw new PacificaOrderValidationError(`${input.market.baseAsset} supports isolated margin only.`);
  }
  if (input.action === 'close' && (input.takeProfitPrice || input.stopLossPrice)) {
    throw new PacificaOrderValidationError('TP/SL can only be attached when opening a position.');
  }
  if (isStopOrder(input.orderType) && (input.takeProfitPrice || input.stopLossPrice)) {
    throw new PacificaOrderValidationError('TP/SL cannot be attached to a stop entry order.');
  }

  const markBaseUnits = input.snapshot.price.baseUnits;
  if (markBaseUnits <= 0n) throw new Error('Pacifica mark price is invalid.');
  const prices = orderPrices({
    action: input.action,
    decimals: input.snapshot.price.decimals,
    mark: markBaseUnits,
    orderPrice: input.orderPrice,
    orderType: input.orderType,
    side: input.side,
    tickSize: input.market.tickSize,
    triggerPrice: input.triggerPrice,
  });
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
  const requestedNotionalBaseUnits = input.action === 'open'
    ? input.collateralBaseUnits * BigInt(leverage)
    : usdNotional(position!.amount, input.snapshot.price.baseUnits);
  const sizingPrice = prices.orderBaseUnits ?? prices.triggerBaseUnits ?? markBaseUnits;
  const amountBaseUnits = input.action === 'open'
    ? (requestedNotionalBaseUnits * 10n ** 14n) / sizingPrice
    : parseDecimal(position!.amount, SIZE_DECIMALS);
  const lot = parseDecimal(input.market.lotSize, SIZE_DECIMALS);
  if (lot <= 0n) throw new Error('Pacifica lot size is invalid.');
  if (input.action === 'close' && amountBaseUnits % lot !== 0n) {
    throw new PacificaOrderValidationError(
      'Pacifica returned a position size that cannot be closed without leaving dust.',
    );
  }
  const roundedAmount = amountBaseUnits - amountBaseUnits % lot;
  if (roundedAmount <= 0n) {
    throw new PacificaOrderValidationError('Order size is below Pacifica market limits.');
  }
  const notionalBaseUnits = usdNotional(
    formatDecimal(roundedAmount, SIZE_DECIMALS),
    sizingPrice,
  );
  const minimum = parseDecimal(input.market.minOrderSize, 6);
  const maximum = parseDecimal(input.market.maxOrderSize, 6);
  if (notionalBaseUnits < minimum || notionalBaseUnits > maximum) {
    throw new PacificaOrderValidationError(
      `Pacifica requires $${input.market.minOrderSize}–$${input.market.maxOrderSize} notional for this market.`,
    );
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
    orderPrice: prices.orderPrice,
    orderType: input.orderType,
    reduceOnly: input.action === 'close',
    side: input.side,
    signedSide: signedSide(input.action, input.side),
    slippagePercent: SLIPPAGE_PERCENT,
    symbol: input.market.venueRef,
    triggerPrice: prices.triggerPrice,
    stopLoss,
    takeProfit,
  };
}

export async function submitPacificaOrder(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly intentStartedAtMs: number;
  readonly plan: PacificaOrderPlan;
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
  if (latest === undefined || latest.priceStale) {
    throw new Error('Pacifica price is stale. Review the order again.');
  }
  if (input.plan.orderType === 'market' && outsideSlippage(input.plan.markPrice, latest)) {
    throw new Error('Pacifica price moved beyond the confirmed slippage limit. Review again.');
  }
  if (isStopOrder(input.plan.orderType)) {
    if (input.plan.triggerPrice === null) {
      throw new Error('Pacifica stop order is missing its confirmed trigger price.');
    }
    validateStopDirection(
      parseDecimal(input.plan.triggerPrice, latest.price.decimals),
      latest.price.baseUnits,
      input.plan.signedSide,
    );
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
  const request = orderRequest(input.plan);
  const result = await pacificaPostSigned<unknown>({
    account: input.account,
    apiOrigin: input.apiOrigin,
    operation: request.operation,
    payload: request.payload,
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

function orderRequest(plan: PacificaOrderPlan): {
  readonly operation: PacificaOperation;
  readonly payload: Readonly<Record<string, unknown>>;
} {
  const targets = {
    ...(plan.stopLoss === null ? {} : {
      stop_loss: { client_order_id: plan.stopLoss.clientOrderId, stop_price: plan.stopLoss.stopPrice },
    }),
    ...(plan.takeProfit === null ? {} : {
      take_profit: { client_order_id: plan.takeProfit.clientOrderId, stop_price: plan.takeProfit.stopPrice },
    }),
  };
  const common = {
    amount: plan.amount,
    client_order_id: plan.clientOrderId,
    reduce_only: plan.reduceOnly,
    side: plan.signedSide,
    symbol: plan.symbol,
  };
  if (plan.orderType === 'market') {
    return {
      operation: 'create_market_order',
      payload: { ...common, slippage_percent: plan.slippagePercent, ...targets },
    };
  }
  if (plan.orderType === 'limit') {
    return {
      operation: 'create_order',
      payload: { ...common, price: plan.orderPrice, tif: 'GTC', ...targets },
    };
  }
  return {
    operation: 'create_stop_order',
    payload: {
      reduce_only: plan.reduceOnly,
      side: plan.signedSide,
      symbol: plan.symbol,
      stop_order: {
        amount: plan.amount,
        client_order_id: plan.clientOrderId,
        stop_price: plan.triggerPrice,
        trigger_price_type: 'mark_price',
        ...(plan.orderType === 'stop-limit' ? { limit_price: plan.orderPrice } : {}),
      },
    },
  };
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
  return {
    clientOrderId: Crypto.randomUUID(),
    stopPrice: validateTriggerPrice(value, label, side, kind, mark, tickSize, decimals),
  };
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

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Pacifica returned an invalid order response.');
  }
  return value as Record<string, unknown>;
}
