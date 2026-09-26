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

/** Which auto-close rows an order still being priced will have. */
export type PendingAutoClose = { readonly stopLoss: boolean; readonly takeProfit: boolean };

type Risk = NonNullable<PacificaOrderPlan['risk']>;

type Row = {
  readonly label: string;
  /** Placeholder width while the plan is pending, varied so the column does not read as a grid. */
  readonly pendingWidth: number;
  readonly spoken?: string;
  readonly value: string | null;
};

/**
 * The prepared order, as the figures that will be signed.
 *
 * Every value here is read off the plan, never recomputed: this is the object the confirmation hands to
 * signing, so what the reader checks is what goes to the venue. Two panels — what the order is, and what
 * it does to the account — so the risk figures are read as a group rather than as more rows of a list.
 *
 * While the plan is still being priced the same rows are drawn with placeholders for their values, and
 * nothing from the form stands in for them. When the plan lands only the values change, so the page does
 * not jump.
 */
export function PreparedOrderSummary({
  baseAsset,
  pending,
  plan,
}: {
  readonly baseAsset: string;
  /** While `plan` is `null`: which auto-close rows to hold room for. */
  readonly pending: PendingAutoClose | null;
  /** The prepared order, or `null` while it is being priced. */
  readonly plan: PacificaOrderPlan | null;
}) {
  const risk = riskRows(plan);

  return (
    <View
      accessibilityLabel={plan === null ? 'Preparing quote' : undefined}
      accessible={plan === null}
      style={styles.summary}
    >
      <Section rows={orderRows(plan, baseAsset, pending)} title="Order" />
      {risk === null ? null : <Section rows={risk} title="Risk" />}
    </View>
  );
}

function orderRows(
  plan: PacificaOrderPlan | null,
  baseAsset: string,
  pending: PendingAutoClose | null,
): readonly Row[] {
  const read = (pick: (ready: PacificaOrderPlan) => string) => (plan === null ? null : pick(plan));
  const rows: Row[] = [
    { label: 'Side', pendingWidth: 84, value: read((p) => `${p.action === 'open' ? 'Open' : 'Close'} ${p.side}`) },
    { label: 'Type', pendingWidth: 56, spoken: 'Order type', value: read((p) => orderTypeText(p.orderType)) },
    { label: 'Size', pendingWidth: 72, value: read((p) => `${p.amount} ${baseAsset}`) },
    { label: 'Notional', pendingWidth: 112, value: read((p) => usdcText(p.notionalBaseUnits)) },
    { label: 'Mark price', pendingWidth: 68, value: read((p) => `$${priceText(p.markPrice)}`) },
    {
      label: 'Leverage',
      pendingWidth: 76,
      value: read((p) => `${p.leverage}× · ${p.marginMode === 'cross' ? 'Cross' : 'Isolated'}`),
    },
    {
      label: 'Est. fee',
      pendingWidth: 100,
      spoken: 'Estimated fee',
      value: read((p) => usdcText(p.estimatedFeeBaseUnits)),
    },
    { label: 'Max slippage', pendingWidth: 40, value: read((p) => `${p.slippagePercent}%`) },
  ];

  const takeProfit = plan === null ? null : plan.takeProfit;
  if (takeProfit !== null || (plan === null && pending?.takeProfit === true)) {
    rows.push({
      label: 'Take profit',
      pendingWidth: 68,
      value: takeProfit === null ? null : `$${priceText(takeProfit.stopPrice)}`,
    });
  }
  const stopLoss = plan === null ? null : plan.stopLoss;
  if (stopLoss !== null || (plan === null && pending?.stopLoss === true)) {
    rows.push({
      label: 'Stop loss',
      pendingWidth: 68,
      value: stopLoss === null ? null : `$${priceText(stopLoss.stopPrice)}`,
    });
  }
  return rows;
}

/** The risk panel's rows, pending until the plan lands, or `null` for a plan that carries no risk. */
function riskRows(plan: PacificaOrderPlan | null): readonly Row[] | null {
  if (plan !== null && plan.risk === null) return null;
  const risk = plan === null ? null : plan.risk;
  const read = (pick: (ready: Risk) => string) => (risk === null ? null : pick(risk));
  return [
    { label: 'Initial margin', pendingWidth: 104, value: read((r) => usdcText(r.initialMarginBaseUnits)) },
    { label: 'Margin after', pendingWidth: 104, value: read((r) => usdcText(r.projectedMarginUsedBaseUnits)) },
    { label: 'Available after', pendingWidth: 96, value: read((r) => usdcText(r.projectedAvailableBaseUnits)) },
    {
      label: 'Maint. buffer',
      pendingWidth: 112,
      spoken: 'Maintenance margin buffer',
      value: read((r) => usdcText(r.maintenanceHeadroomBaseUnits)),
    },
    { label: 'Account health', pendingWidth: 64, value: read((r) => accountHealthText(r.accountHealthBps)) },
    {
      label: 'Projected liq.',
      pendingWidth: 92,
      spoken: 'Projected liquidation price',
      value: read((r) => (r.liquidationPrice === null ? 'None above $0' : `$${priceText(r.liquidationPrice)}`)),
    },
  ];
}

function Section({ rows, title }: { readonly rows: readonly Row[]; readonly title: string }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.eyebrow}>{title}</Text>
      <TicketPanel style={styles.panel}>
        {/* Keyed by label, so a row keeps its identity from placeholder to value and only the value swaps. */}
        {rows.map((row) => (
          <TicketFigure
            key={row.label}
            label={row.label}
            pendingWidth={row.pendingWidth}
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
