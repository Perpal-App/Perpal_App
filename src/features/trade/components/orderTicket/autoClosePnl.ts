import {
  amountFromBaseUnits,
  formatDetailedUsd,
  parseAmount,
  type Amount,
} from '@/domain/money/amount';
import { TRIGGER_FIELD, type TriggerKind } from '@/features/trade/components/orderTicket/autoCloseCheck';
import { entryAmount } from '@/features/trade/components/orderTicket/keypadEntry';
import type { AutoClosePrices } from '@/features/trade/hooks/useOrderTicketDraft';
import type { PacificaOrderSide } from '@/integrations/perps/pacifica/pacificaOrderValidation';

/** USDC base units in one cent, at the token's six decimals. */
const CENT = 10_000n;

/** Take profit first, the order every summary of the two prices uses. */
const KINDS: readonly TriggerKind[] = ['take-profit', 'stop-loss'];

const SPOKEN_KIND: Readonly<Record<TriggerKind, string>> = {
  'stop-loss': 'stop loss',
  'take-profit': 'take profit',
};

/** Which way an estimate points. */
export type PnlDirection = 'flat' | 'gain' | 'loss';

/** An estimate as it is drawn: which way it points, and how much, as unsigned dollars and cents. */
export type PnlFigure = { readonly direction: PnlDirection; readonly dollars: string };

/** The estimate at one auto-close price. */
export type AutoCloseEstimate = { readonly figure: PnlFigure; readonly kind: TriggerKind };

/**
 * What an auto-close price would realise if the position closed there, in signed USDC base units — or
 * `null` when there is no size or no price to estimate from.
 *
 * The position is taken as the order would open it: collateral × leverage of notional, entered at the
 * current mark. A long gains as price rises through that mark and a short as it falls, in proportion to the
 * move. Integer arithmetic throughout; nothing here is a float.
 *
 * An estimate, and said so wherever it is shown. It is gross of fees, it assumes a fill at the mark on the
 * way in and exactly at the trigger on the way out, and it ignores the lot rounding review applies to the
 * size — each of which moves the real figure a little, none of which review has decided yet.
 */
export function estimatedTriggerPnl(input: {
  /** The keypad's collateral, as a plain decimal. */
  readonly collateral: string;
  readonly leverage: number;
  readonly mark: Amount;
  /** The trigger price, as a plain decimal. */
  readonly price: string;
  readonly side: PacificaOrderSide;
}): bigint | null {
  const { leverage, mark, side } = input;
  if (!Number.isInteger(leverage) || leverage < 1 || mark.baseUnits <= 0n) return null;
  if (input.collateral.length === 0 || input.price.length === 0) return null;

  let collateral: bigint;
  let price: bigint;
  try {
    collateral = parseAmount(input.collateral, 6).baseUnits;
    price = parseAmount(input.price, mark.decimals).baseUnits;
  } catch {
    return null;
  }
  if (collateral <= 0n || price <= 0n) return null;

  const notional = collateral * BigInt(leverage);
  const move = side === 'long' ? price - mark.baseUnits : mark.baseUnits - price;
  return (notional * move) / mark.baseUnits;
}

/**
 * The estimate at each auto-close price that is set, take profit first, for the collapsed auto-close card,
 * which shows what the exits come to without being opened.
 *
 * Empty until the keypad has written an amount to size from, so nothing is drawn beside the prices until
 * there is something true to draw. Recomputed on every render, so it follows the amount as it is typed, the
 * leverage as it is changed and the mark as it moves.
 */
export function autoCloseEstimates(input: {
  /** The keypad's collateral, as a plain decimal. */
  readonly collateral: string;
  readonly leverage: number;
  readonly mark: Amount;
  /** The keypad entries for the two prices, as the draft holds them. */
  readonly prices: AutoClosePrices;
  readonly side: PacificaOrderSide;
}): readonly AutoCloseEstimate[] {
  const { collateral, leverage, mark, prices, side } = input;
  const estimates: AutoCloseEstimate[] = [];
  for (const kind of KINDS) {
    const price = entryAmount(prices[TRIGGER_FIELD[kind]]);
    const pnl = estimatedTriggerPnl({ collateral, leverage, mark, price, side });
    if (pnl !== null) estimates.push({ figure: pnlFigure(pnl), kind });
  }
  return estimates;
}

/**
 * A profit or loss ready to draw beside a caret: its direction, and its size as unsigned dollars and cents
 * — `gain` and `$12.40`, `loss` and `$3.07`. The caret carries the sign, so the amount does not repeat it.
 *
 * Rounded to the cent in the cautious direction for each sign, so an estimate never flatters: a profit is
 * shown no larger than it is, and a loss no smaller. The direction is read off that rounded figure rather
 * than the exact one, so a gain too small to reach a cent is flat — never an arrow pointing up at $0.00.
 */
export function pnlFigure(pnl: bigint): PnlFigure {
  const loss = pnl < 0n;
  const magnitude = loss ? -pnl : pnl;
  const cents = loss ? (magnitude + CENT - 1n) / CENT : magnitude / CENT;
  return {
    direction: cents === 0n ? 'flat' : loss ? 'loss' : 'gain',
    dollars: formatDetailedUsd(amountFromBaseUnits(cents * CENT, 6)),
  };
}

/**
 * An estimate with its sign: `+$91.50`, `−$3.07`, `$0.00`. The loss sign is a true minus rather than a
 * hyphen, so it is the width of the plus and sits on the figures' centre line; a flat figure has neither.
 */
export function signedDollars(figure: PnlFigure): string {
  if (figure.direction === 'flat') return figure.dollars;
  return `${figure.direction === 'gain' ? '+' : '\u2212'}${figure.dollars}`;
}

/** An estimate in words, for a screen reader: `estimated profit $91.50`. */
export function spokenPnl(figure: PnlFigure): string {
  if (figure.direction === 'flat') return `estimated ${figure.dollars}`;
  return `estimated ${figure.direction === 'gain' ? 'profit' : 'loss'} ${figure.dollars}`;
}

/** Every estimate in words, each with the price it belongs to: `estimated profit $91.50 at take profit`. */
export function spokenEstimates(estimates: readonly AutoCloseEstimate[]): string {
  return estimates.map(({ figure, kind }) => `${spokenPnl(figure)} at ${SPOKEN_KIND[kind]}`).join(', ');
}
