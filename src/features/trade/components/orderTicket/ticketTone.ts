import type { ActionButtonTone } from '@/components/ui/ActionButton';
import type { PacificaOrderSide } from '@/integrations/perps/pacifica/pacificaOrder';
import { colors } from '@/theme/tokens';

/** The colours the ticket can take: the trade's side, or the accent on the deposit form. */
export type TicketTone = Exclude<ActionButtonTone, 'neutral'>;

/**
 * What each tone paints a chosen control with: `ink` for its label, `rim` for its edge and any filled
 * track, `wash` for a translucent fill behind it.
 *
 * The washes are the palette's own translucent greens and reds — the order book's depth fills — rather than
 * new colours, so a chosen share on a long ticket is the same green as a bid two screens back.
 */
export const TICKET_TONES: Readonly<Record<TicketTone, { readonly ink: string; readonly rim: string; readonly wash: string }>> = {
  accent: { ink: colors.accentSoft, rim: colors.accent, wash: colors.glassHighlight },
  negative: { ink: colors.negative, rim: colors.negative, wash: colors.depthAsk },
  positive: { ink: colors.positive, rim: colors.positive, wash: colors.depthBid },
};

/**
 * The ticket's colour, decided in one place: green for a long, red for a short, and the accent on the
 * deposit form, which is not a trade and has no side. Every selection on the ticket and its action use it,
 * so what is chosen and what it is chosen for always agree.
 */
export function ticketTone(deposit: boolean, side: PacificaOrderSide): TicketTone {
  if (deposit) return 'accent';
  return side === 'long' ? 'positive' : 'negative';
}
