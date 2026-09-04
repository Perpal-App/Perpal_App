import { amountFromBaseUnits, formatAmount, parseAmount } from '@/domain/money/amount';
import {
  swapAssetDecimals,
  type SwapAsset,
  type WalletStablecoinSwapPlan,
  type WalletSwapScope,
} from '@/integrations/solana/walletStablecoinSwap';

export function walletLabel(scope: WalletSwapScope): string {
  return scope === 'public' ? 'Public wallet' : 'Private wallet';
}

export function formatSwapAmount(value: bigint, asset: SwapAsset): string {
  return formatAmount(amountFromBaseUnits(value, swapAssetDecimals(asset)));
}

export function formatSol(value: bigint): string {
  return `${formatAmount(amountFromBaseUnits(value, 9))} SOL`;
}

export function optionalSol(value: bigint): string | null {
  return value > 0n ? formatSol(value) : null;
}

export function parseSwapInput(value: string, asset: SwapAsset): bigint | null {
  try {
    return parseAmount(value, swapAssetDecimals(asset)).baseUnits;
  } catch {
    return null;
  }
}

export function maxConfirmationNotice(plan: WalletStablecoinSwapPlan): string | null {
  if (plan.amountMode !== 'max') return null;
  return plan.from === 'SOL'
    ? 'Maximum spendable SOL was calculated from the current network fee and account rent.'
    : 'This spends the full USDC balance.';
}

export function formatSwapExpiry(expiresAtMs: number): string {
  return new Date(expiresAtMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
