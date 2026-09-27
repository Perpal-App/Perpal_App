import { amountFromBaseUnits, parseAmount, type Amount } from '@/domain/money/amount';
import type { PacificaPosition } from '@/integrations/perps/pacifica/pacificaPortfolio';

/** Sizes and prices are read at ten places, the precision the venue publishes both in. */
const VENUE_DECIMALS = 10;
/** USD values are exact at six places, matching the stablecoins they are settled in. */
const USD_DECIMALS = 6;
/** Size × price carries twenty places; dropping fourteen leaves USD at six. */
const TO_USD = 10n ** BigInt(VENUE_DECIMALS * 2 - USD_DECIMALS);
/** A venue USD figure read at ten places, brought to six. */
const VENUE_TO_USD = 10n ** BigInt(VENUE_DECIMALS - USD_DECIMALS);

/**
 * The liquidation price the venue reports. At or below zero it is still a real figure — the price the mark
 * would have to reach, which it cannot, because the account's cross margin covers any fall to zero — and it
 * is kept rather than replaced with a word, so the reader sees the number the venue computed.
 */
export type LiquidationLevel =
  | { readonly kind: 'price'; readonly price: Amount }
  | { readonly kind: 'belowZero'; readonly price: Amount }
  | { readonly kind: 'unknown' };

/** What a position comes to at the current mark. Every figure is exact, from integer arithmetic. */
export type PositionFigures = {
  readonly entryPrice: Amount;
  /** What the position cost to open: size × entry, in USD. */
  readonly entryValue: Amount;
  /** The multiple it runs at, or `null` while that is not known. */
  readonly leverage: number | null;
  readonly liquidation: LiquidationLevel;
  /**
   * The capital the position holds, in USD. Isolated, the margin the venue has set aside for it; cross, its
   * entry value over its leverage — the venue reports none against a cross position, because the margin is
   * the account's.
   */
  readonly marginUsed: Amount | null;
  /** The mark it is valued at, or `null` without one. */
  readonly mark: Amount | null;
  /** What the position is worth now: size × mark, in USD. */
  readonly notional: Amount | null;
  /** The move as basis points of the entry value, signed the way the position gains. */
  readonly pnlBps: number | null;
  /** The profit or loss as basis points of the capital used: return on margin. */
  readonly roeBps: number | null;
  readonly size: Amount;
  /** Unrealized profit or loss at the mark, in USD: positive when the position is ahead. */
  readonly unrealizedPnl: Amount | null;
};

/**
 * A position valued at a live mark price, so its profit and loss move with the market rather than waiting
 * for the venue's own figure, which it does not always publish.
 *
 * A long gains as the mark rises through its entry and a short as it falls: `(mark − entry) × size`, with the
 * sign turned for a short. Nothing here is rounded until display; the divisions to USD truncate toward zero,
 * by less than a millionth of a dollar.
 *
 * `null` when the venue's numbers cannot be read, so a card shows it cannot value the position instead of
 * showing a wrong one. A liquidation price at or below zero is kept as `belowZero`: the venue's own figure,
 * for a position the account's cross margin covers all the way down.
 */
export function positionFigures(
  position: PacificaPosition,
  mark: Amount | null,
  leverage: number | null,
): PositionFigures | null {
  let size: bigint;
  let entry: bigint;
  try {
    size = abs(venueAmount(position.amount).baseUnits);
    entry = venueAmount(position.entryPrice).baseUnits;
  } catch {
    return null;
  }

  const markUnits = mark === null ? null : rescale(mark, VENUE_DECIMALS);
  const direction = position.side === 'long' ? 1n : -1n;
  const entryValue = (size * entry) / TO_USD;
  const pnl = markUnits === null ? null : ((markUnits - entry) * size * direction) / TO_USD;
  const known = leverage !== null && Number.isInteger(leverage) && leverage >= 1 ? leverage : null;
  const margin = marginUsed(position, entryValue, known);

  return {
    entryPrice: amountFromBaseUnits(entry, VENUE_DECIMALS),
    entryValue: amountFromBaseUnits(entryValue, USD_DECIMALS),
    leverage: known,
    liquidation: liquidationLevel(position.liquidationPrice),
    marginUsed: margin === null ? null : amountFromBaseUnits(margin, USD_DECIMALS),
    mark: markUnits === null ? null : amountFromBaseUnits(markUnits, VENUE_DECIMALS),
    notional: markUnits === null ? null : amountFromBaseUnits((size * markUnits) / TO_USD, USD_DECIMALS),
    pnlBps: pnl === null || entryValue === 0n ? null : Number((pnl * 10_000n) / entryValue),
    roeBps: pnl === null || margin === null || margin === 0n ? null : Number((pnl * 10_000n) / margin),
    size: amountFromBaseUnits(size, VENUE_DECIMALS),
    unrealizedPnl: pnl === null ? null : amountFromBaseUnits(pnl, USD_DECIMALS),
  };
}

/**
 * A venue decimal at ten places. The venue does not always stop there: an average entry — a market order
 * filled across several levels of a thin book — can carry more, and read strictly that one extra place
 * left the whole position unvalued, and off the chart. The excess is dropped toward zero instead: less
 * than a ten-billionth of a unit of price, far under anything shown.
 */
function venueAmount(text: string): Amount {
  const match = /^(-?\d*)\.(\d+)$/u.exec(text.trim());
  const fraction = match?.[2];
  if (match !== null && fraction !== undefined && fraction.length > VENUE_DECIMALS) {
    return parseAmount(`${match[1] ?? ''}.${fraction.slice(0, VENUE_DECIMALS)}`, VENUE_DECIMALS);
  }
  return parseAmount(text, VENUE_DECIMALS);
}

/** Several positions valued together. */
export type PositionTotals = {
  /** The capital behind them all, or `null` while any one position's is not known. */
  readonly marginUsed: Amount | null;
  /** The move as basis points of what the positions cost to open. */
  readonly pnlBps: number | null;
  /** The profit or loss as basis points of the capital behind them: return on margin. */
  readonly roeBps: number | null;
  readonly unrealizedPnl: Amount;
};

/**
 * The positions' own figures added up, for a headline that has to agree with the cards under it to the
 * cent: the same exact amounts, summed before anything is rounded, and rates taken on the same bases the
 * cards use. `null` while any position cannot be valued — a total with one of its parts missing is a wrong
 * number, not a small one. No positions is a real zero.
 */
export function totalPositionFigures(figures: readonly (PositionFigures | null)[]): PositionTotals | null {
  let pnl = 0n;
  let entry = 0n;
  let margin: bigint | null = 0n;
  for (const item of figures) {
    if (item === null || item.unrealizedPnl === null) return null;
    pnl += item.unrealizedPnl.baseUnits;
    entry += item.entryValue.baseUnits;
    margin = margin === null || item.marginUsed === null ? null : margin + item.marginUsed.baseUnits;
  }
  return {
    marginUsed: margin === null ? null : amountFromBaseUnits(margin, USD_DECIMALS),
    pnlBps: entry === 0n ? null : Number((pnl * 10_000n) / entry),
    roeBps: margin === null || margin === 0n ? null : Number((pnl * 10_000n) / margin),
    unrealizedPnl: amountFromBaseUnits(pnl, USD_DECIMALS),
  };
}

function marginUsed(position: PacificaPosition, entryValue: bigint, leverage: number | null): bigint | null {
  if (position.marginMode === 'isolated') {
    try {
      return venueAmount(position.margin).baseUnits / VENUE_TO_USD;
    } catch {
      return null;
    }
  }
  return leverage === null ? null : entryValue / BigInt(leverage);
}

function liquidationLevel(value: string | null): LiquidationLevel {
  if (value === null) return { kind: 'unknown' };
  try {
    const price = venueAmount(value);
    return price.baseUnits <= 0n ? { kind: 'belowZero', price } : { kind: 'price', price };
  } catch {
    return { kind: 'unknown' };
  }
}

/** An amount at another scale. Only ever widened here; a narrower one would need a rounding rule. */
function rescale(amount: Amount, decimals: number): bigint {
  const shift = decimals - amount.decimals;
  return shift >= 0 ? amount.baseUnits * 10n ** BigInt(shift) : amount.baseUnits / 10n ** BigInt(-shift);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
