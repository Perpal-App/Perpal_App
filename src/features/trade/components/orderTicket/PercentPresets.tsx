import { TicketChips, type ChipOption } from '@/features/trade/components/orderTicket/TicketChips';
import type { TicketTone } from '@/features/trade/components/orderTicket/ticketTone';

/**
 * Shares of the available balance a reader can commit in one tap.
 *
 * The last is the whole balance and says `Max` rather than `100%`: it is the one people reach for by
 * meaning rather than by number.
 */
const PRESETS: readonly ChipOption[] = [25, 50, 75, 100].map((percent) => ({
  label: percent === 100 ? 'Max' : `${percent}%`,
  spoken: percent === 100 ? 'Maximum available' : `${percent}% of available`,
  value: percent,
}));

/** The collateral presets, directly above the keypad they stand in for. */
export function PercentPresets(props: {
  readonly onSelect: (percent: number) => void;
  readonly selected: number | null;
  readonly tone: TicketTone;
}) {
  return <TicketChips onSelect={props.onSelect} options={PRESETS} selected={props.selected} tone={props.tone} />;
}
