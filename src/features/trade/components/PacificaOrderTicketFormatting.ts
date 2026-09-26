import {
  amountFromBaseUnits,
  formatAmountWithCommas,
  formatDetailedUsd,
  parseAmount,
  truncateAmount,
} from '@/domain/money/amount';
import type { TradingStablecoinBalances } from '@/features/trade/hooks/useTradingStablecoinBalances';
import type {
  PacificaOrderPlan,
  PacificaOrderSubmission,
} from '@/integrations/perps/pacifica/pacificaOrder';
import type { InAppNotificationInput } from '@/storage/inAppNotifications';

export function availableTradingFundsBaseUnits(
  providerAvailable: string | undefined,
  privateBalances: TradingStablecoinBalances | null,
): bigint | null {
  if (privateBalances === null) return null;
  try {
    const provider = providerAvailable === undefined
      ? 0n
      : parseAmount(providerAvailable, 6).baseUnits;
    return provider + privateBalances.usdcBaseUnits;
  } catch {
    return null;
  }
}

export function usdcText(value: bigint): string {
  return `${formatAmountWithCommas(amountFromBaseUnits(value, 6))} USDC`;
}

export function priceText(value: string): string {
  try { return formatAmountWithCommas(parseAmount(value, 10)); } catch { return value; }
}

export function orderTypeText(value: PacificaOrderPlan['orderType']): string {
  const words = value.replace('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function orderConfirmation(plan: PacificaOrderPlan, baseAsset: string) {
  const risk = plan.risk;
  return {
    title: `${plan.action === 'open' ? 'Open' : 'Close'} ${plan.side} ${baseAsset}?`,
    message: [
      `Order type ${plan.orderType.replace('-', ' ')}`,
      `Size ${plan.amount} ${baseAsset}`,
      `Mark $${priceText(plan.markPrice)}`,
      plan.triggerPrice === null ? null : `Trigger $${priceText(plan.triggerPrice)}`,
      plan.orderPrice === null ? null : `Limit $${priceText(plan.orderPrice)}`,
      `Notional ${usdcText(plan.notionalBaseUnits)}`,
      `Estimated fee ${usdcText(plan.estimatedFeeBaseUnits)}`,
      `Leverage ${plan.leverage}× · ${plan.marginMode}`,
      risk === null ? null : `Initial margin ${usdcText(risk.initialMarginBaseUnits)}`,
      risk === null ? null : `Margin after ${usdcText(risk.projectedMarginUsedBaseUnits)}`,
      risk === null ? null : `Available after ${usdcText(risk.projectedAvailableBaseUnits)}`,
      risk === null ? null : `Maintenance buffer ${usdcText(risk.maintenanceHeadroomBaseUnits)}`,
      risk === null ? null : `Account health ${accountHealthText(risk.accountHealthBps)}`,
      risk === null ? null : `Projected liquidation ${risk.liquidationPrice === null
        ? 'none above $0'
        : `$${priceText(risk.liquidationPrice)}`}`,
      `Slippage limit ${plan.slippagePercent}%`,
      plan.takeProfit === null ? null : `Take profit $${priceText(plan.takeProfit.stopPrice)}`,
      plan.stopLoss === null ? null : `Stop loss $${priceText(plan.stopLoss.stopPrice)}`,
    ].filter(Boolean).join('\n'),
  };
}

export function usdFromBaseUnits(value: bigint): string {
  return `$${formatAmountWithCommas(amountFromBaseUnits(value, 6))}`;
}

/**
 * A USDC balance as dollars and cents — `$2,534.41` — truncated rather than rounded, so a balance on
 * display is never a fraction of a cent more than what is there.
 */
export function usdCentsText(value: bigint): string {
  return formatDetailedUsd(truncateAmount(amountFromBaseUnits(value, 6), 2));
}

/**
 * What `collateral × leverage` comes to, before the venue's lot rounding.
 *
 * The same product the plan starts from — `preparePacificaOrder` sizes an opening order off exactly
 * this — which is why it is marked approximate rather than exact: the plan then rounds the size down
 * to the market's lot, so the notional that is signed can come in slightly under this and never over.
 * The exact figure is on the prepared order.
 */
export function positionSizeEstimate(collateral: string, leverage: number): string {
  if (!Number.isInteger(leverage) || leverage < 1) return '--';
  try {
    const base = parseAmount(collateral, 6).baseUnits;
    return base <= 0n ? '--' : `≈ ${usdCentsText(base * BigInt(leverage))}`;
  } catch {
    return '--';
  }
}

/** The auto-close row's second line: the prices it will act on, or `null` when there are none. */
export function autoCloseSummary(takeProfit: string, stopLoss: string): string | null {
  const parts = [
    takeProfit.trim().length === 0 ? null : `TP $${priceText(takeProfit.trim())}`,
    stopLoss.trim().length === 0 ? null : `SL $${priceText(stopLoss.trim())}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * The two lines of the post-trade confirmation.
 *
 * `placed` and `filled` are not interchangeable and the status decides which is true. A fresh market
 * order normally comes back `accepted` — Pacifica has the request and its final state is still
 * reconciling — so "placed" is the honest word for it, and only a status that really is a fill says
 * filled. Getting this wrong would be the screen claiming an execution the venue has not reported.
 *
 * The size is `plan.amount` exactly as signed, not a rounded version of it: the figure the reader is
 * shown after the fact has to be the figure that went to the venue.
 */
export function orderPlacedCopy(
  plan: PacificaOrderPlan,
  baseAsset: string,
  status: PacificaOrderSubmission['orderStatus'],
): { readonly detail: string; readonly headline: string } {
  const filled = status === 'filled' || status === 'partially_filled';
  const verb = plan.action === 'close'
    ? `Close ${plan.side}`
    : plan.side === 'long' ? 'Buy' : 'Sell';
  return {
    detail: `${verb} ${plan.amount} ${baseAsset} for ${usdFromBaseUnits(plan.notionalBaseUnits)}`,
    headline: `Your ${orderTypeText(plan.orderType).toLowerCase()} order has been ${
      filled ? 'filled' : 'placed'
    }`,
  };
}

export function accountHealthText(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}%`;
}

export function orderSubmissionNotification(
  plan: PacificaOrderPlan,
  baseAsset: string,
  status: PacificaOrderSubmission['orderStatus'],
): Pick<InAppNotificationInput, 'kind' | 'message' | 'outcome' | 'status' | 'title'> {
  const accepted = status === 'accepted';
  return {
    kind: 'trade',
    outcome: status === 'rejected' ? 'error' : accepted || status === 'cancelled' ? 'info' : 'success',
    status: status === 'rejected'
      ? 'failed'
      : status === 'open' || status === 'partially_filled'
        ? 'accepted'
        : status,
    title: status === 'rejected'
      ? 'Order rejected'
      : status === 'cancelled'
        ? 'Order already cancelled'
        : accepted
          ? 'Order request accepted'
          : `${plan.action === 'open' ? 'Open' : 'Close'} order confirmed`,
    message: accepted
      ? `Pacifica acknowledged the ${baseAsset} order. Its final state is reconciling.`
      : `${baseAsset} ${plan.side} order is ${status.replace('_', ' ')} on Pacifica.`,
  };
}
