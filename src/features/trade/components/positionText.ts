import { formatAmountWithCommas, formatFixedWithCommas, type Amount } from '@/domain/money/amount';

const MINUS = '\u2212';

/** How many decimals a price step allows: `0.01` is 2, `1` is 0. `null` for a step that cannot be read. */
export function tickPlaces(tick: string): number | null {
  if (!/^\d+(?:\.\d+)?$/u.test(tick)) return null;
  return (tick.split('.')[1] ?? '').replace(/0+$/u, '').length;
}

/**
 * A position's price at its market's tick, grouped, with a true minus below zero: `$121.47`. At the
 * venue's own precision when the tick is not known.
 */
export function formatPositionPrice(value: Amount, places: number | null): string {
  const negative = value.baseUnits < 0n;
  const magnitude = negative ? { ...value, baseUnits: -value.baseUnits } : value;
  const body = places === null ? formatAmountWithCommas(magnitude) : formatFixedWithCommas(magnitude, places);
  return `${negative ? MINUS : ''}$${body}`;
}
