import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { TicketPageHeader } from '@/features/trade/components/orderTicket/TicketPageHeader';
import { spacing } from '@/theme/tokens';

/**
 * A ticket page's arrangement: the header and body from the top, the footer from the bottom.
 *
 * The footer is where each page keeps its action, and it sits at the bottom edge for the same reason the
 * form's keypad does — it is reached for with a thumb. `space-between` rather than a spacer view, so when
 * the page is taller than the screen the two groups simply stack and the sheet scrolls.
 */
export function TicketPageLayout({
  accessory,
  backDisabled,
  children,
  footer,
  onBack,
  title,
}: {
  readonly accessory?: ReactNode;
  readonly backDisabled?: boolean;
  readonly children: ReactNode;
  readonly footer: ReactNode;
  readonly onBack: () => void;
  readonly title: string;
}) {
  return (
    <View style={styles.layout}>
      <View style={styles.top}>
        <TicketPageHeader
          accessory={accessory}
          onBack={onBack}
          title={title}
          {...(backDisabled === undefined ? null : { backDisabled })}
        />
        {children}
      </View>
      <View style={styles.bottom}>{footer}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  layout: { flex: 1, justifyContent: 'space-between', gap: spacing.lg },
  top: { gap: spacing.md },
  bottom: { gap: spacing.sm },
});
