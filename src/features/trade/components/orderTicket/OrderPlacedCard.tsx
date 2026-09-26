import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PresenceView } from '@/components/motion/PresenceView';
import { PressableScale } from '@/components/ui/PressableScale';
import { orderPlacedCopy } from '@/features/trade/components/PacificaOrderTicketFormatting';
import { PlacedCheckmark } from '@/features/trade/components/orderTicket/PlacedCheckmark';
import type { PacificaOrderPlaced } from '@/features/trade/hooks/usePacificaOrderFlow';
import { colors, interfaceType, radii, spacing } from '@/theme/tokens';

/**
 * How long the confirmation stays before it leaves on its own.
 *
 * Longer than a toast's two seconds, because this carries a size and a cash figure the reader may want to
 * check against what they entered. Short enough never to stand between them and the next order — and
 * `Done` is always there, so the timer is not the only way out.
 */
const DISMISS_AFTER_MS = 4_200;

/** The card grows into place out of the button that was pressed, rather than sliding over it. */
const ENTER_SCALE = 0.94;
const ENTER_TRAVEL = 10;

/**
 * The confirmation a placed order gets, over the ticket that placed it.
 *
 * On the sheet's own surface and over the whole ticket, so it reads as the sheet turning over rather than
 * a card stacked on the form. Two ways out — the timer and `Done` — run the same exit, and neither clears
 * the receipt: `onDismissed` does, once the card has actually gone, so its text cannot blank out halfway
 * through its own departure.
 */
export function OrderPlacedCard({
  baseAsset,
  onDismissed,
  placed,
}: {
  readonly baseAsset: string;
  /** Fired after the exit finishes, including under reduce motion. */
  readonly onDismissed: () => void;
  readonly placed: PacificaOrderPlaced | null;
}) {
  const [open, setOpen] = useState(false);

  // Keyed on the receipt's identity, so a second order restarts the countdown rather than inheriting what
  // was left of the first one's — the same reason `AppToastHost` keys its timer by toast id.
  useEffect(() => {
    if (placed === null) return undefined;
    setOpen(true);
    const timer = setTimeout(() => setOpen(false), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [placed]);

  if (placed === null) return null;

  const copy = orderPlacedCopy(placed.plan, baseAsset, placed.orderStatus);

  return (
    <PresenceView
      accessibilityViewIsModal
      fromScale={ENTER_SCALE}
      offsetY={ENTER_TRAVEL}
      onExited={onDismissed}
      style={styles.card}
      visible={open}
    >
      {/* One live region for the pair of lines, so a screen reader announces the outcome and the figure as
          one statement instead of interrupting itself between them. */}
      <View accessibilityLiveRegion="polite" style={styles.body}>
        <PlacedCheckmark />
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={styles.headline}>
          {copy.headline}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.detail}>{copy.detail}</Text>
      </View>

      {/* `pressBeforeAction`: the compression finishes before the card starts leaving, so the tap is
          visibly acknowledged rather than swallowed by the exit it triggers. */}
      <PressableScale
        accessibilityHint="Returns to the order ticket"
        accessibilityLabel="Done"
        accessibilityRole="button"
        onPress={() => setOpen(false)}
        pressBeforeAction
        style={styles.close}
      >
        <Text style={styles.closeLabel}>Done</Text>
      </PressableScale>
    </PresenceView>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xl,
    backgroundColor: colors.surface,
  },
  body: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  headline: { ...interfaceType.title, color: colors.textPrimary, textAlign: 'center' },
  detail: { ...interfaceType.body, color: colors.textSecondary, textAlign: 'center' },
  // Quiet by construction: the order is already at the venue, so this is an acknowledgement, not an
  // action, and it does not take the accent a live control would.
  // Pill-shaped, like every other action at the foot of the ticket.
  close: {
    minHeight: 44,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  closeLabel: { ...interfaceType.control, color: colors.textPrimary },
});
