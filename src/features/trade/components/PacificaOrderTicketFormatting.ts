import {
  amountFromBaseUnits,
  formatAmountWithCommas,
  parseAmount,
} from '@/domain/money/amount';
import type { TradingStablecoinBalances } from '@/features/trade/hooks/useTradingStablecoinBalances';
import type { PacificaOrderPlan } from '@/integrations/perps/pacifica/pacificaOrder';

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
      `Slippage limit ${plan.slippagePercent}%`,
      plan.takeProfit === null ? null : `Take profit $${priceText(plan.takeProfit.stopPrice)}`,
      plan.stopLoss === null ? null : `Stop loss $${priceText(plan.stopLoss.stopPrice)}`,
    ].filter(Boolean).join('\n'),
  };
}
