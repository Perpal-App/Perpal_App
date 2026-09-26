import { useState } from 'react';

import type { Amount } from '@/domain/money/amount';
import {
  autoCloseProblems,
  firstProblem,
  NO_PROBLEMS,
  TRIGGER_FIELD,
  type TriggerKind,
  type TriggerProblems,
} from '@/features/trade/components/orderTicket/autoCloseCheck';
import {
  applyKeypadKey,
  stepDecimals,
  type KeypadKey,
} from '@/features/trade/components/orderTicket/keypadEntry';
import type {
  OrderTicketDraft,
  useOrderTicketDraft,
} from '@/features/trade/hooks/useOrderTicketDraft';
import type { PacificaOrderSide } from '@/integrations/perps/pacifica/pacificaOrder';

/** The two options that open in place. */
export type TicketEditor = 'autoClose' | 'leverage';

/** What a refused key shakes: the collateral figure, or one of the two prices. */
export type RejectTarget = 'collateral' | TriggerKind;

/**
 * Cents. The figure reads as dollars, the balance beside it is shown to the cent and the presets truncate
 * to it, so an entry finer than a cent would be the one figure on the card that nothing else agrees with.
 */
const COLLATERAL_DECIMALS = 2;

type DraftActions = Pick<
  ReturnType<typeof useOrderTicketDraft>,
  'setAutoClose' | 'setEntry' | 'setLeverage' | 'setTriggerPrice'
>;

/**
 * Which option is open on the ticket, and where the keypad is typing.
 *
 * The options edit the draft live — there is no Set and no Cancel. That is what lets them open in place:
 * an option that only applied on confirm would need somewhere to hold its unconfirmed value and a way to
 * throw it away, which is a page, not a card. It is safe because nothing is priced while the form is in
 * use; a prepared order exists only under the review page, which covers every control here, and each edit
 * still calls `onEdit` so nothing ever outlives the inputs it was built from.
 *
 * The keypad has one owner at a time. It writes the collateral, until auto close is open; then it writes
 * whichever of the two prices is focused, at the market's tick precision.
 *
 * Auto close is the one option with a way to be wrong, so leaving it checks it: a price the order builder
 * would refuse keeps the card open, with the builder's reason under the field and the field shaking. Every
 * way out — Done, the card's own header, another option, the collateral figure — goes through that check.
 */
export function useTicketEditing(input: {
  readonly actions: DraftActions;
  /**
   * The deposit form, which has no options. An option open when the account turns into one is closed on the
   * spot, so the keypad goes back to writing the amount instead of a price no one can see.
   */
  readonly disabled: boolean;
  readonly draft: OrderTicketDraft;
  readonly mark: Amount;
  /** Drops anything priced from the draft. Called beside every edit. */
  readonly onEdit: () => void;
  readonly side: PacificaOrderSide;
  readonly tickSize: string;
}) {
  const { actions, disabled, draft, mark, onEdit, side, tickSize } = input;
  const [editor, setEditor] = useState<TicketEditor | null>(null);
  // State adjusted during render, React's pattern for state that follows a prop: no effect, and no frame in
  // which the keypad could still be pointed at a closed option.
  if (disabled && editor !== null) setEditor(null);
  const [focus, setFocus] = useState<TriggerKind>('take-profit');
  const [errors, setErrors] = useState<TriggerProblems>(NO_PROBLEMS);
  const [rejects, setRejects] = useState<Readonly<Record<RejectTarget, number>>>({
    collateral: 0,
    'stop-loss': 0,
    'take-profit': 0,
  });

  const reject = (target: RejectTarget) => setRejects((count) => ({ ...count, [target]: count[target] + 1 }));

  /** Moves to `next` — another option, or none — unless auto close is open and would be left wrong. */
  const leave = (next: TicketEditor | null) => {
    if (editor === 'autoClose' && next !== 'autoClose') {
      const problems = autoCloseProblems(draft, side, mark, tickSize);
      const first = firstProblem(problems);
      if (first !== null) {
        setErrors(problems);
        setFocus(first);
        reject(first);
        return;
      }
    }
    setErrors(NO_PROBLEMS);
    // Opening auto close lands on the take profit unless only a stop loss has been set.
    if (next === 'autoClose') setFocus(draft.takeProfit.length === 0 && draft.stopLoss.length > 0 ? 'stop-loss' : 'take-profit');
    setEditor(next);
  };

  const pressKey = (key: KeypadKey) => {
    if (editor === 'autoClose') {
      const current = draft[TRIGGER_FIELD[focus]];
      const next = applyKeypadKey(current, key, stepDecimals(tickSize));
      if (next === current) {
        reject(focus);
        return;
      }
      onEdit();
      actions.setTriggerPrice(TRIGGER_FIELD[focus], next);
      if (errors[focus] !== null) setErrors((shown) => ({ ...shown, [focus]: null }));
      return;
    }
    const next = applyKeypadKey(draft.entry, key, COLLATERAL_DECIMALS);
    if (next === draft.entry) {
      reject('collateral');
      return;
    }
    onEdit();
    actions.setEntry(next);
  };

  /** Holding delete: empties whichever figure the keypad is writing. */
  const clearKey = () => {
    if (editor === 'autoClose') {
      if (draft[TRIGGER_FIELD[focus]].length === 0) return;
      onEdit();
      actions.setTriggerPrice(TRIGGER_FIELD[focus], '');
      setErrors((shown) => ({ ...shown, [focus]: null }));
      return;
    }
    if (draft.entry.length === 0) return;
    onEdit();
    actions.setEntry('');
  };

  const changeLeverage = (next: number) => {
    if (next === draft.leverage) return;
    onEdit();
    actions.setLeverage(next);
  };

  const clearAutoClose = () => {
    onEdit();
    actions.setAutoClose({ stopLoss: '', takeProfit: '' });
    setErrors(NO_PROBLEMS);
    setFocus('take-profit');
  };

  /** A new market or identity: everything closes, nothing is checked, because the draft is being reset. */
  const restart = () => {
    setEditor(null);
    setErrors(NO_PROBLEMS);
    setFocus('take-profit');
  };

  return {
    changeLeverage,
    clearAutoClose,
    clearKey,
    close: () => leave(null),
    editor,
    errors,
    focus,
    focusField: setFocus,
    pressKey,
    rejects,
    restart,
    /** Opens an option, or closes it if it is the one already open. */
    toggle: (kind: TicketEditor) => leave(editor === kind ? null : kind),
  };
}
