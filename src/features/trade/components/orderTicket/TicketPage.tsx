import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { PresenceView } from '@/components/motion/PresenceView';
import { colors } from '@/theme/tokens';

/**
 * The page grows into place from just under full size, the way the order confirmation does — the two
 * are the same kind of surface, a page of the ticket laid over its form, and should arrive alike.
 */
const ENTER_SCALE = 0.96;
const ENTER_TRAVEL = 12;

/**
 * A page of the order ticket — leverage, auto close, the review — laid over the form.
 *
 * Over it rather than swapped in for it, so the form stays mounted exactly as it was and backing out
 * lands the reader where they left. And not a second sheet: a sheet over a sheet is a modal presented
 * from a modal, which is fragile on iOS, and it would have to size itself to its content — the thing
 * `DraggableSheet` refuses to do, because a height taken from content still settling is how that sheet
 * used to get stuck.
 *
 * It fills the ticket's box, which fills the sheet, so a page can pin its action to the bottom the same
 * way the form pins its keypad. `accessibilityViewIsModal` keeps VoiceOver inside it while it is up; the
 * ticket hides the form from TalkBack separately, which does not honour that.
 *
 * Mounted for as long as the ticket is. Its content is keyed by the caller, so each opening starts from
 * the ticket's current values while this shell — and the transition it plays — stays put.
 */
export function TicketPage({
  children,
  visible,
}: {
  readonly children: ReactNode;
  readonly visible: boolean;
}) {
  return (
    <PresenceView
      accessibilityViewIsModal
      fromScale={ENTER_SCALE}
      offsetY={ENTER_TRAVEL}
      style={styles.page}
      visible={visible}
    >
      {children}
    </PresenceView>
  );
}

const styles = StyleSheet.create({
  // On the sheet's own surface, so the page reads as the sheet turning over rather than a card on it.
  page: { position: 'absolute', inset: 0, backgroundColor: colors.surface },
});
