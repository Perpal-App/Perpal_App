import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import type { PushTransition } from '@/components/motion/usePushTransition';
import { colors } from '@/theme/tokens';

/**
 * A page of the order ticket, the review, pushed over the form the way a navigation stack pushes a page and
 * popped back off it by Back.
 *
 * Over the form rather than swapped in for it, so the form stays mounted exactly as it was and backing out
 * lands the reader where they left. And not a second sheet: a sheet over a sheet is a modal presented from
 * a modal, which is fragile on iOS.
 *
 * It fills the ticket's box, which fills the sheet, so the page can pin its action to the bottom the same
 * way the form pins its keypad. Opaque, on the sheet's own surface, so the form is never seen through it.
 * `accessibilityViewIsModal` keeps VoiceOver inside it while it is up; the ticket hides the form from
 * TalkBack separately, which does not honour that.
 *
 * Entering animations are skipped for what the page arrives with, since the push brings that in. What
 * changes on it afterwards, such as the quote's figures landing, still fades in.
 */
export function TicketPage({
  children,
  transition,
}: {
  readonly children: ReactNode;
  readonly transition: PushTransition;
}) {
  if (!transition.mounted) return null;
  return (
    <Animated.View accessibilityViewIsModal style={[styles.page, transition.pageStyle]}>
      <LayoutAnimationConfig skipEntering>{children}</LayoutAnimationConfig>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { position: 'absolute', inset: 0, backgroundColor: colors.surface },
});
