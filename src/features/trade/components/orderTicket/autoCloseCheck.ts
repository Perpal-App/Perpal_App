import type { Amount } from '@/domain/money/amount';
import { entryAmount } from '@/features/trade/components/orderTicket/keypadEntry';
import type { AutoClosePrices } from '@/features/trade/hooks/useOrderTicketDraft';
import {
  PacificaOrderValidationError,
  validateTriggerPrice,
  type PacificaOrderSide,
} from '@/integrations/perps/pacifica/pacificaOrderValidation';

export type TriggerKind = 'take-profit' | 'stop-loss';

/** What is wrong with each auto-close price, or `null` for one that is fine or not set. */
export type TriggerProblems = Readonly<Record<TriggerKind, string | null>>;

export const NO_PROBLEMS: TriggerProblems = { 'stop-loss': null, 'take-profit': null };

/** Which draft field each price lives in. */
export const TRIGGER_FIELD: Readonly<Record<TriggerKind, keyof AutoClosePrices>> = {
  'stop-loss': 'stopLoss',
  'take-profit': 'takeProfit',
};

const NAMES: Readonly<Record<TriggerKind, string>> = {
  'stop-loss': 'Stop-loss',
  'take-profit': 'Take-profit',
};

/**
 * Why a take-profit or stop-loss price would be refused, in the order builder's own words — or `null`.
 *
 * It runs `validateTriggerPrice`, the check the order builder itself applies, so a price this accepts is
 * one review will accept too: against the mark as it stands now. The mark keeps moving, which is why review
 * checks again rather than trusting this, and why the ticket re-asks on every render instead of caching it.
 */
export function triggerProblem(
  value: string,
  kind: TriggerKind,
  side: PacificaOrderSide,
  mark: Amount,
  tickSize: string,
): string | null {
  const price = entryAmount(value);
  if (price.length === 0) return null;
  try {
    validateTriggerPrice(price, NAMES[kind], side, kind, mark.baseUnits, tickSize, mark.decimals);
    return null;
  } catch (cause) {
    return cause instanceof PacificaOrderValidationError ? cause.message : 'Enter a valid price.';
  }
}

export function autoCloseProblems(
  prices: AutoClosePrices,
  side: PacificaOrderSide,
  mark: Amount,
  tickSize: string,
): TriggerProblems {
  return {
    'stop-loss': triggerProblem(prices.stopLoss, 'stop-loss', side, mark, tickSize),
    'take-profit': triggerProblem(prices.takeProfit, 'take-profit', side, mark, tickSize),
  };
}

/** The first price with a problem, take profit before stop loss, or `null` when both are fine. */
export function firstProblem(problems: TriggerProblems): TriggerKind | null {
  if (problems['take-profit'] !== null) return 'take-profit';
  return problems['stop-loss'] !== null ? 'stop-loss' : null;
}
