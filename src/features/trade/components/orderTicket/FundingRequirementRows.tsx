import { StyleSheet } from 'react-native';

import { usdcText } from '@/features/trade/components/PacificaOrderTicketFormatting';
import { TicketFigure } from '@/features/trade/components/orderTicket/TicketFigure';
import { TicketPanel } from '@/features/trade/components/orderTicket/TicketPanel';
import type { TradeFundingRequirement } from '@/integrations/perps/tradeCollateral';
import { spacing } from '@/theme/tokens';

/**
 * The two figures behind a deposit that cannot be paid: what Pacifica needs, and what there is.
 *
 * Just the numbers. The remedy is the action's own `Add funds`, beside the block it answers, where a
 * reader looking at "Insufficient funds" finds it without reading past it.
 */
export function FundingRequirementRows({
  requirement,
}: {
  readonly requirement: TradeFundingRequirement | null;
}) {
  if (requirement === null) return null;
  return (
    <TicketPanel style={styles.panel}>
      <TicketFigure label="Min required" value={usdcText(requirement.minimumBaseUnits)} />
      <TicketFigure label="Ready to deposit" value={usdcText(requirement.usdcAvailableBaseUnits)} />
    </TicketPanel>
  );
}

const styles = StyleSheet.create({
  panel: { gap: spacing.xxs, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
});
