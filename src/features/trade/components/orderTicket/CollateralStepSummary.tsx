import { StyleSheet, Text, View } from 'react-native';

import {
  collateralStepBlockedMessage,
  collateralStepRows,
} from '@/features/trade/components/orderTicket/collateralStepCopy';
import { TicketFigure } from '@/features/trade/components/orderTicket/TicketFigure';
import { TicketPanel } from '@/features/trade/components/orderTicket/TicketPanel';
import {
  tradeCollateralStepCanSubmit,
  type TradeCollateralStep,
} from '@/integrations/perps/tradeCollateral';
import { colors, interfaceType, spacing } from '@/theme/tokens';

/**
 * A collateral step on its review: the transfer that has to land in Pacifica before the order can be
 * priced against it, and — when its simulation did not pass — what is missing.
 */
export function CollateralStepSummary({
  deposit,
  step,
}: {
  /** The deposit form, where this transfer is the whole point rather than a step on the way to an order. */
  readonly deposit: boolean;
  readonly step: TradeCollateralStep;
}) {
  return (
    <View style={styles.summary}>
      {deposit ? null : (
        <Text style={styles.lead}>
          This order needs more collateral in Pacifica than is there. Move it first, then review the order.
        </Text>
      )}
      <TicketPanel style={styles.panel}>
        {collateralStepRows(step).map(([label, value]) => (
          <TicketFigure key={label} label={label} value={value} />
        ))}
      </TicketPanel>
      {tradeCollateralStepCanSubmit(step) ? null : (
        <Text accessibilityRole="alert" style={styles.blocked}>{collateralStepBlockedMessage(step)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: spacing.sm },
  lead: { ...interfaceType.caption, color: colors.textMuted },
  panel: { gap: spacing.xxs, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  blocked: { ...interfaceType.body, color: colors.textSecondary },
});
