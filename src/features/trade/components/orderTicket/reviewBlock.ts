import { parseAmount } from '@/domain/money/amount';
import { usdFromBaseUnits } from '@/features/trade/components/PacificaOrderTicketFormatting';
import { entryAmount } from '@/features/trade/components/orderTicket/keypadEntry';

/**
 * Why the ticket's review action is not available yet, in the words its button shows — or `null`.
 *
 * The button carries the reason rather than a message beside it, because it is where the reader is
 * looking when they reach for it, and a disabled button that says what it needs is an instruction
 * rather than a dead end. Nothing here is the real check. Review re-validates everything against a
 * fresh account read; these only refuse inputs that could not survive it.
 *
 * Each check is conservative in the direction that matters. The position size here is collateral ×
 * leverage, before the order builder rounds its size down to the market's lot — so the order it would
 * build can only be smaller than this, and a figure under the minimum here is certainly under it there.
 */
export function reviewBlock(input: {
  readonly availableBaseUnits: bigint | null;
  readonly entry: string;
  /** The floor the entry is measured against: a deposit's own size, or the position it opens. */
  readonly minimum:
    | { readonly kind: 'deposit'; readonly baseUnits: bigint }
    | { readonly kind: 'position'; readonly baseUnits: bigint | null; readonly leverage: number };
}): string | null {
  const committed = entryBaseUnits(input.entry);
  if (committed === null || committed <= 0n) return 'Enter an amount';
  if (input.availableBaseUnits !== null && committed > input.availableBaseUnits) {
    return 'Exceeds available balance';
  }

  const { minimum } = input;
  if (minimum.kind === 'deposit') {
    return committed < minimum.baseUnits
      ? `Minimum deposit ${usdFromBaseUnits(minimum.baseUnits)}`
      : null;
  }
  if (minimum.baseUnits === null) return null;
  return committed * BigInt(minimum.leverage) < minimum.baseUnits
    ? `Minimum position ${usdFromBaseUnits(minimum.baseUnits)}`
    : null;
}

/** The keypad entry in USDC base units, or `null` when it is empty or not a valid amount. */
export function entryBaseUnits(entry: string): bigint | null {
  return usdcBaseUnits(entryAmount(entry));
}

/** A plain decimal in USDC base units, or `null` when it is empty or malformed. */
export function usdcBaseUnits(value: string): bigint | null {
  if (value.trim().length === 0) return null;
  try {
    return parseAmount(value, 6).baseUnits;
  } catch {
    return null;
  }
}
