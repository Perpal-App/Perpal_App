import {
  amountFromBaseUnits,
  formatAmountWithCommas,
  parseAmount,
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

export function privateUsdcText(balances: TradingStablecoinBalances | null): string {
  if (balances === null) return '--';
  return usdcText(balances.usdcBaseUnits);
}

export function usdcText(value: bigint): string {
  return `${formatAmountWithCommas(amountFromBaseUnits(value, 6))} USDC`;
}

export function decimalUsd(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) return '--';
  try { return `$${formatAmountWithCommas(parseAmount(value, 6))}`; } catch { return '--'; }
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
