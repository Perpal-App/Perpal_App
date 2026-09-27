import type { ActivityItem } from '@/features/portfolio/components/activityItems';
import { colors } from '@/theme/tokens';

/**
 * Which way value moved, resolved once for the whole row.
 *
 * Read from the sign already printed on the amount rather than re-derived from the event kind, and
 * that ordering matters: a funding payment goes either way round and a balance transfer can be a
 * credit or a debit, so deriving direction from the kind would eventually disagree with the number
 * sitting beside it. An unsigned amount is a move that changed nothing — an exchange, or a hop
 * between two wallets the same person owns.
 */
export type ActivityDirection = 'error' | 'in' | 'neutral' | 'out';

export function activityDirection(item: ActivityItem): ActivityDirection {
  if (item.outcome === 'error') return 'error';
  if (item.value?.startsWith('+') === true) return 'in';
  if (item.value?.startsWith('-') === true) return 'out';
  return 'neutral';
}

/**
 * The event's colour, which the row carries in its text now that it has no mark to carry it: green for
 * value arriving, red for value leaving or for a failure, and full-contrast white for a move that is
 * neither, which is still the row's primary figure.
 */
export function activityAmountColor(direction: ActivityDirection): string {
  if (direction === 'in') return colors.positive;
  if (direction === 'out' || direction === 'error') return colors.negative;
  return colors.textPrimary;
}
