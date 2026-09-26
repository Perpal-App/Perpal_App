import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { TicketPageHeader } from '@/features/trade/components/orderTicket/TicketPageHeader';
import { spacing } from '@/theme/tokens';

/**
 * A ticket page's arrangement — today, the review's: the header and body at their own height, the footer
 * taking the rest.
 *
 * The footer is where the page keeps its action, at the bottom edge for the same reason the form's is — it
 * is reached for with a thumb. It grows and sits its content at the end, rather than being pushed down by
 * `space-between`, so anything in it that can use spare height is free to take it.
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
  layout: { flex: 1, gap: spacing.lg },
  top: { gap: spacing.md },
  bottom: { flexGrow: 1, justifyContent: 'flex-end', gap: spacing.sm },
});
