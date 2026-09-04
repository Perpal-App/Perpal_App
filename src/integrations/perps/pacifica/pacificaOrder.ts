import * as Crypto from 'expo-crypto';

import {
  type PacificaMarket,
  type PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import {
  fetchPacificaMarketSetting,
  type PacificaMarketSetting,
} from '@/integrations/perps/pacifica/pacificaOrderReconciliation';
import {
  projectPacificaOpeningRisk,
  type PacificaProjectedRisk,
} from '@/integrations/perps/pacifica/pacificaOrderRisk';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  formatDecimal,
  isStopOrder,
  orderPrices,
  parseDecimal,
  PacificaOrderValidationError,
  signedSide,
  validateTriggerPrice,
  type PacificaOrderAction,
  type PacificaOrderSide,
  type PacificaOrderType,
} from '@/integrations/perps/pacifica/pacificaOrderValidation';
import { newTraceId } from '@/integrations/observability/clientTelemetry';

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
  readonly maxLeverage: number;
  readonly notionalBaseUnits: bigint;
  readonly orderPrice: string | null;
  readonly orderType: PacificaOrderType;
  readonly reduceOnly: boolean;
  readonly reviewedSetting: PacificaMarketSetting | null;
  readonly risk: PacificaProjectedRisk | null;
  readonly side: PacificaOrderSide;
  readonly signedSide: 'bid' | 'ask';
  readonly slippagePercent: string;
  readonly symbol: string;
  readonly triggerPrice: string | null;
  readonly stopLoss: PacificaTriggerOrder | null;
  readonly takeProfit: PacificaTriggerOrder | null;
  readonly traceId: string;
};

export async function preparePacificaOrder(input: {
  readonly account: string;
  readonly action: PacificaOrderAction;
  readonly apiOrigin: string;
  readonly collateralBaseUnits: bigint;
  readonly leverage: number;
  readonly marginMode: PacificaMarginMode;
  readonly market: PacificaMarket;
  readonly orderPrice: string | undefined;
  readonly orderType: PacificaOrderType;
  readonly portfolio: PacificaPortfolioSnapshot;
  readonly side: PacificaOrderSide;
  readonly snapshot: PacificaMarketSnapshot;
  readonly signal?: AbortSignal | undefined;
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
  const estimatedFeeBaseUnits = (
    notionalBaseUnits * feeRate + 99_999_999n
  ) / 100_000_000n;
  const reviewedSetting = input.action === 'open'
    ? await fetchPacificaMarketSetting({
        account: input.account,
        apiOrigin: input.apiOrigin,
        maxLeverage: input.market.maxLeverage,
        signal: input.signal,
        symbol: input.market.venueRef,
      })
    : null;
  if (reviewedSetting !== null) {
    validateSettingChange({
      leverage,
      marginMode: input.marginMode,
      portfolio: input.portfolio,
      reviewedSetting,
      symbol: input.market.venueRef,
    });
  }
  const risk = input.action === 'open'
    ? projectPacificaOpeningRisk({
        amountBaseUnits: roundedAmount,
        estimatedFeeBaseUnits,
        leverage,
        marginMode: input.marginMode,
        maxLeverage: input.market.maxLeverage,
        notionalBaseUnits,
        portfolio: input.portfolio,
        side: input.side,
        sizingPriceBaseUnits: sizingPrice,
        snapshot: input.snapshot,
        symbol: input.market.venueRef,
      })
    : null;

  return {
    action: input.action,
    amount: formatDecimal(roundedAmount, SIZE_DECIMALS),
    clientOrderId: Crypto.randomUUID(),
    collateralBaseUnits: input.collateralBaseUnits,
    estimatedFeeBaseUnits,
    expiresAtMs: Date.now() + PLAN_LIFETIME_MS,
    leverage,
    marginMode: input.action === 'open' ? input.marginMode : position!.marginMode,
    markPrice: formatDecimal(markBaseUnits, input.snapshot.price.decimals),
    maxLeverage: input.market.maxLeverage,
    notionalBaseUnits,
    orderPrice: prices.orderPrice,
    orderType: input.orderType,
    reduceOnly: input.action === 'close',
    reviewedSetting,
    risk,
    side: input.side,
    signedSide: signedSide(input.action, input.side),
    slippagePercent: SLIPPAGE_PERCENT,
    symbol: input.market.venueRef,
    triggerPrice: prices.triggerPrice,
    stopLoss,
    takeProfit,
    traceId: newTraceId(),
  };
}

export {
  cancelPacificaOrder,
  PacificaCommandPendingError,
  submitPacificaOrder,
  type PacificaCancellationResult,
  type PacificaOrderSubmission,
} from '@/integrations/perps/pacifica/pacificaOrderLifecycle';

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

function usdNotional(amount: string, priceBaseUnits: bigint): bigint {
  return (parseDecimal(amount, SIZE_DECIMALS) * priceBaseUnits) / 10n ** 14n;
}

function parseRate(value: string): bigint {
  const rate = parseDecimal(value, 8);
  if (rate <= 0n) throw new Error('Pacifica fee data is unavailable. Refresh the portfolio.');
  return rate;
}

function validateSettingChange(input: {
  readonly leverage: number;
  readonly marginMode: PacificaMarginMode;
  readonly portfolio: PacificaPortfolioSnapshot;
  readonly reviewedSetting: PacificaMarketSetting;
  readonly symbol: string;
}): void {
  const hasExposure = input.portfolio.positions.some(
    (position) => position.symbol === input.symbol,
  ) || input.portfolio.orders.some((order) => order.symbol === input.symbol);
  if (!hasExposure) return;
  if (
    input.reviewedSetting.marginMode !== input.marginMode ||
    input.reviewedSetting.leverage !== input.leverage
  ) {
    throw new PacificaOrderValidationError(
      `Existing ${input.symbol} exposure uses ${input.reviewedSetting.marginMode} margin at ` +
      `${input.reviewedSetting.leverage}×. Use those settings or close/cancel it first.`,
    );
  }
}
