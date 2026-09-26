import { useMemo, useState } from 'react';

import { amountFromBaseUnits, formatAmount, truncateAmount } from '@/domain/money/amount';
import type { PacificaOrderDraft } from '@/features/trade/hooks/usePacificaOrderFlow';
import { entryAmount } from '@/features/trade/components/orderTicket/keypadEntry';
import type {
  PacificaMarginMode,
  PacificaOrderSide,
} from '@/integrations/perps/pacifica/pacificaOrder';

/** Where leverage starts on a fresh ticket, capped by what the market allows. */
const DEFAULT_LEVERAGE = 5;

/**
 * What the reader has set on the ticket, and nothing the ticket derives from it.
 *
 * `entry` is the keypad's raw text — it can end in a point while it is being typed — and `preset` is
 * which percentage wrote it, if one did, so that chip can show as chosen until the figure is edited by
 * hand. Auto close is on exactly when either price is set: there is no separate switch to disagree with
 * the prices.
 */
export type OrderTicketDraft = {
  readonly entry: string;
  readonly leverage: number;
  readonly preset: number | null;
  readonly stopLoss: string;
  readonly takeProfit: string;
};

export type AutoClosePrices = Pick<OrderTicketDraft, 'stopLoss' | 'takeProfit'>;

function initialDraft(maxLeverage: number): OrderTicketDraft {
  return {
    entry: '',
    leverage: Math.max(1, Math.min(DEFAULT_LEVERAGE, maxLeverage)),
    preset: null,
    stopLoss: '',
    takeProfit: '',
  };
}

/**
 * The ticket's draft, and the only ways to change it.
 *
 * Every action is a functional update, so none of them closes over a stale draft, and the set is built
 * once, so a component handed one never re-renders because it was rebuilt. None of them drops a
 * prepared plan: that is the flow's `reset`, and the ticket calls it beside each edit because only the
 * ticket holds both.
 */
export function useOrderTicketDraft(maxLeverage: number) {
  const [draft, setDraft] = useState(() => initialDraft(maxLeverage));

  const actions = useMemo(() => ({
    /** After an order lands: the size and its exits were for that order. Leverage is a setting, and stays. */
    clearAfterOrder: () => setDraft((current) => ({
      ...current,
      entry: '',
      preset: null,
      stopLoss: '',
      takeProfit: '',
    })),
    restart: (max: number) => setDraft(initialDraft(max)),
    setAutoClose: (prices: AutoClosePrices) => setDraft((current) => ({ ...current, ...prices })),
    setEntry: (entry: string) => setDraft((current) => ({ ...current, entry, preset: null })),
    setLeverage: (leverage: number) => setDraft((current) => ({ ...current, leverage })),
    setPreset: (preset: number, entry: string) => setDraft((current) => ({ ...current, entry, preset })),
  }), []);

  return { draft, ...actions };
}

export function autoCloseOn(draft: AutoClosePrices): boolean {
  return draft.takeProfit.length > 0 || draft.stopLoss.length > 0;
}

/**
 * The share of a balance a preset commits, as a keypad entry.
 *
 * Integer arithmetic, truncated to the cent: a preset can come in under its share and never over it, so
 * `Max` is never more than what is there — and it is exactly the balance the collateral card prints,
 * which is truncated to the cent the same way.
 */
export function presetEntry(availableBaseUnits: bigint, percent: number): string {
  const share = BigInt(Math.max(0, Math.min(100, Math.round(percent))));
  return formatAmount(truncateAmount(amountFromBaseUnits((availableBaseUnits * share) / 100n, 6), 2));
}

/**
 * The draft as the order flow reads it: always an opening market order.
 *
 * The ticket offers nothing else, so the order type, the limit and trigger prices, and the action are
 * fixed here in one place rather than threaded through as state no control can change.
 */
export function marketOrderDraft(
  draft: OrderTicketDraft,
  side: PacificaOrderSide,
  marginMode: PacificaMarginMode,
): PacificaOrderDraft {
  return {
    action: 'open',
    collateral: entryAmount(draft.entry),
    leverage: String(draft.leverage),
    limitPrice: '',
    marginMode,
    orderType: 'market',
    side,
    stopLoss: draft.stopLoss,
    takeProfit: draft.takeProfit,
    tpSlEnabled: autoCloseOn(draft),
    triggerPrice: '',
  };
}
