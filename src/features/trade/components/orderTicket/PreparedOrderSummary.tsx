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
import { colors, interfaceType, spacing } from '@/theme/tokens';

type Row = {
  readonly label: string;
  readonly spoken?: string;
  readonly value: string;
};

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
      <Section rows={orderRows(plan, baseAsset)} title="Order" />
      {risk === null ? null : <Section rows={riskRows(risk)} title="Risk" />}
    </View>
  );
}

function orderRows(plan: PacificaOrderPlan, baseAsset: string): readonly Row[] {
  return [
    { label: 'Side', value: `${plan.action === 'open' ? 'Open' : 'Close'} ${plan.side}` },
    { label: 'Type', spoken: 'Order type', value: orderTypeText(plan.orderType) },
    { label: 'Size', value: `${plan.amount} ${baseAsset}` },
    { label: 'Notional', value: usdcText(plan.notionalBaseUnits) },
    { label: 'Mark price', value: `$${priceText(plan.markPrice)}` },
    { label: 'Leverage', value: `${plan.leverage}× · ${plan.marginMode === 'cross' ? 'Cross' : 'Isolated'}` },
    { label: 'Est. fee', spoken: 'Estimated fee', value: usdcText(plan.estimatedFeeBaseUnits) },
    { label: 'Max slippage', value: `${plan.slippagePercent}%` },
    ...(plan.takeProfit === null
      ? []
      : [{ label: 'Take profit', value: `$${priceText(plan.takeProfit.stopPrice)}` }]),
    ...(plan.stopLoss === null
      ? []
      : [{ label: 'Stop loss', value: `$${priceText(plan.stopLoss.stopPrice)}` }]),
  ];
}

function riskRows(risk: NonNullable<PacificaOrderPlan['risk']>): readonly Row[] {
  return [
    { label: 'Initial margin', value: usdcText(risk.initialMarginBaseUnits) },
    { label: 'Margin after', value: usdcText(risk.projectedMarginUsedBaseUnits) },
    { label: 'Available after', value: usdcText(risk.projectedAvailableBaseUnits) },
    {
      label: 'Maint. buffer',
      spoken: 'Maintenance margin buffer',
      value: usdcText(risk.maintenanceHeadroomBaseUnits),
    },
    { label: 'Account health', value: accountHealthText(risk.accountHealthBps) },
    {
      label: 'Projected liq.',
      spoken: 'Projected liquidation price',
      value: risk.liquidationPrice === null ? 'None above $0' : `$${priceText(risk.liquidationPrice)}`,
    },
  ];
}

function Section({ rows, title }: { readonly rows: readonly Row[]; readonly title: string }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.eyebrow}>{title}</Text>
      <TicketPanel style={styles.panel}>
        {rows.map((row) => (
          <TicketFigure
            key={row.label}
            label={row.label}
            {...(row.spoken === undefined ? null : { screenReaderLabel: row.spoken })}
            value={row.value}
          />
        ))}
      </TicketPanel>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: spacing.md },
  section: { gap: spacing.xs },
  eyebrow: { ...interfaceType.overline, paddingHorizontal: spacing.xxs, color: colors.textMuted },
  panel: { gap: spacing.xxs, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
});
