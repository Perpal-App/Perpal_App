import {
  addAmounts,
  amountFromBaseUnits,
  formatDetailedUsd,
  parseAmount,
  subtractAmounts,
  type Amount,
} from '@/domain/money/amount';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';

/**
 * The account figures, in one place, because two screens now show them.
 *
 * These were private to `AccountOverviewCard` while it was the only thing rendering them. The
 * portfolio card needs the same numbers in a different layout, and a second copy of "unrealized PnL
 * is equity minus deposited balance" is exactly the duplicated money maths that ends with two
 * screens disagreeing about a balance.
 *
 * Every one of them returns `null` rather than a zero when an input is missing. A total with one of
 * its halves absent is a wrong number, not a small one, and rendering it as `$0.00` tells the reader
 * something false about their money.
 *
 * The wallet side is typed structurally rather than against `WalletBalances`, so this stays free of
 * a feature import. `WalletBalances` is assignable to `WalletPair` as-is.
 */

export type ValuedWallet = {
  readonly valuation: {
    readonly unpricedAssetCount: number;
    readonly usdBaseUnits: bigint;
  } | null;
};

export type WalletPair = {
  readonly privateWallet: ValuedWallet | null;
  readonly publicWallet: ValuedWallet | null;
};

export type FigureTone = 'negative' | 'plain' | 'positive';

/** USD valuation is priced at 6 decimals, matching the stablecoins it is quoted against. */
const USD_DECIMALS = 6;

export function walletFunds(wallet: ValuedWallet | null): Amount | null {
  return wallet === null || wallet.valuation === null
    ? null
    : amountFromBaseUnits(wallet.valuation.usdBaseUnits, USD_DECIMALS);
}

/**
 * The private side is the private wallet plus whatever is committed to the venue.
 *
 * Equity rather than deposited balance, so an open position's unrealized move is inside the figure
 * the reader is told they hold privately.
 */
export function privateFunds(
  balances: WalletPair | null,
  portfolio: PacificaPortfolioSnapshot | null,
): Amount | null {
  if (balances === null || portfolio === null) return null;

  const wallet = walletFunds(balances.privateWallet);
  if (wallet === null) return null;

  try {
    return addAmounts(wallet, parseAmount(portfolio.accountEquity, USD_DECIMALS));
  } catch {
    return null;
  }
}

/** Names how many holdings the valuation could not price, so a low total is explained not hidden. */
export function walletLabel(label: string, wallet: ValuedWallet | null): string {
  const count = wallet?.valuation?.unpricedAssetCount ?? 0;
  return count === 0 ? label : `${label} · ${count} unpriced`;
}

export function unrealizedPnl(portfolio: PacificaPortfolioSnapshot | null): Amount | null {
  if (portfolio === null) return null;

  try {
    return subtractAmounts(
      parseAmount(portfolio.accountEquity, USD_DECIMALS),
      parseAmount(portfolio.balance, USD_DECIMALS),
    );
  } catch {
    return null;
  }
}

/**
 * The move as basis points of the deposited balance it was earned on.
 *
 * Integer maths on base units throughout: converting to a float first to divide would put rounding
 * error into a figure the reader will compare against the amount beside it. Null on a zero base,
 * because a percentage off zero is either infinity or a lie.
 */
export function unrealizedRate(
  portfolio: PacificaPortfolioSnapshot | null,
  pnl: Amount | null,
): number | null {
  if (portfolio === null || pnl === null) return null;

  try {
    const base = parseAmount(portfolio.balance, USD_DECIMALS);
    if (base.baseUnits === 0n) return null;

    return Number((pnl.baseUnits * 10_000n) / base.baseUnits);
  } catch {
    return null;
  }
}

/** Null unless both parts are known: a total missing one of its halves is a wrong number. */
export function sumAmounts(left: Amount | null, right: Amount | null): Amount | null {
  if (left === null || right === null) return null;

  try {
    return addAmounts(left, right);
  } catch {
    return null;
  }
}

export function money(value: Amount | null): string | null {
  return value === null ? null : formatDetailedUsd(value);
}

/** Signed only upward: `formatDetailedUsd` already carries the minus on a loss. */
export function signedMoney(value: Amount | null): string | null {
  const formatted = money(value);
  return formatted === null || value === null || value.baseUnits <= 0n
    ? formatted
    : `+${formatted}`;
}

/** Flat at exactly zero, so a dormant account is not tinted as though it had won or lost. */
export function amountTone(value: Amount | null): FigureTone {
  if (value === null || value.baseUnits === 0n) return 'plain';
  return value.baseUnits > 0n ? 'positive' : 'negative';
}

export function percent(basisPoints: number): string {
  const absolute = Math.abs(basisPoints);
  const sign = basisPoints > 0 ? '+' : basisPoints < 0 ? '-' : '';
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}%`;
}
