import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  accountHealthText,
  orderTypeText,
  priceText,
  usdcText,
} from '@/features/trade/components/PacificaOrderTicketFormatting';
import { TicketFigure } from '@/features/trade/components/orderTicket/TicketFigure';
import { TicketPanel } from '@/features/trade/components/orderTicket/TicketPanel';
import type { PacificaOrderPlan } from '@/integrations/perps/pacifica/pacificaOrder';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * The prepared order, as the figures that will be signed.
 *
 * Every value here is read off the plan, never recomputed: this is the object the confirmation hands to
 * signing, so what the reader checks is what goes to the venue. Two panels — what the order is, and what
 * it does to the account — so the risk figures are read as a group rather than as more rows of a list.
 */
export function PreparedOrderSummary({
  baseAsset,
  plan,
}: {
  readonly baseAsset: string;
  readonly plan: PacificaOrderPlan;
}) {
  const risk = plan.risk;

  return (
    <View style={styles.summary}>
      <Section title="ORDER">
        <TicketFigure label="Side" value={`${plan.action === 'open' ? 'Open' : 'Close'} ${plan.side}`} />
        <TicketFigure label="Type" screenReaderLabel="Order type" value={orderTypeText(plan.orderType)} />
        <TicketFigure label="Size" value={`${plan.amount} ${baseAsset}`} />
        <TicketFigure label="Notional" value={usdcText(plan.notionalBaseUnits)} />
        <TicketFigure label="Mark price" value={`$${priceText(plan.markPrice)}`} />
        <TicketFigure
          label="Leverage"
          value={`${plan.leverage}× · ${plan.marginMode === 'cross' ? 'Cross' : 'Isolated'}`}
        />
        <TicketFigure label="Est. fee" screenReaderLabel="Estimated fee" value={usdcText(plan.estimatedFeeBaseUnits)} />
        <TicketFigure label="Max slippage" value={`${plan.slippagePercent}%`} />
        {plan.takeProfit === null ? null : (
          <TicketFigure label="Take profit" value={`$${priceText(plan.takeProfit.stopPrice)}`} />
        )}
        {plan.stopLoss === null ? null : (
          <TicketFigure label="Stop loss" value={`$${priceText(plan.stopLoss.stopPrice)}`} />
        )}
      </Section>
      {risk === null ? null : (
        <Section title="RISK">
          <TicketFigure label="Initial margin" value={usdcText(risk.initialMarginBaseUnits)} />
          <TicketFigure label="Margin after" value={usdcText(risk.projectedMarginUsedBaseUnits)} />
          <TicketFigure label="Available after" value={usdcText(risk.projectedAvailableBaseUnits)} />
          <TicketFigure
            label="Maint. buffer"
            screenReaderLabel="Maintenance margin buffer"
            value={usdcText(risk.maintenanceHeadroomBaseUnits)}
          />
          <TicketFigure label="Account health" value={accountHealthText(risk.accountHealthBps)} />
          <TicketFigure
            label="Projected liq."
            screenReaderLabel="Projected liquidation price"
            value={risk.liquidationPrice === null ? 'None above $0' : `$${priceText(risk.liquidationPrice)}`}
          />
        </Section>
      )}
    </View>
  );
}

function Section({ children, title }: { readonly children: ReactNode; readonly title: string }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.eyebrow}>{title}</Text>
      <TicketPanel style={styles.panel}>{children}</TicketPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: spacing.md },
  section: { gap: spacing.xs },
  eyebrow: { ...typography.eyebrow, letterSpacing: 0.5, paddingHorizontal: spacing.xxs, color: colors.textMuted },
  panel: { gap: spacing.xxs, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
});
