import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { positionSizeEstimate } from '@/features/trade/components/PacificaOrderTicketFormatting';
import { LeverageSlider } from '@/features/trade/components/orderTicket/LeverageSlider';
import { LeverageStepper } from '@/features/trade/components/orderTicket/LeverageStepper';
import { TicketFigure } from '@/features/trade/components/orderTicket/TicketFigure';
import { TicketPageLayout } from '@/features/trade/components/orderTicket/TicketPageLayout';
import { TicketPanel } from '@/features/trade/components/orderTicket/TicketPanel';
import type { PacificaMarginMode } from '@/integrations/perps/pacifica/pacificaOrder';
import { colors, spacing, typography } from '@/theme/tokens';

/**
 * The leverage page: the figure between two steppers, a slider under it, and what the choice comes to.
 *
 * Held locally until `Set` is pressed. A leverage change discards any prepared order — a plan priced at
 * one leverage must never be signable at another — so applying on every step of a drag would re-render
 * the whole ticket on each step for nothing. Back leaves the ticket exactly as it was.
 */
export function LeveragePage({
  baseAsset,
  collateral,
  current,
  hasExposure,
  marginMode,
  max,
  onApply,
  onBack,
}: {
  readonly baseAsset: string;
  /** What is entered on the ticket, for the position size this leverage would make of it. */
  readonly collateral: string;
  readonly current: number;
  /** An open position or order on this market, which pins leverage at the venue. */
  readonly hasExposure: boolean;
  readonly marginMode: PacificaMarginMode;
  readonly max: number;
  readonly onApply: (next: number) => void;
  readonly onBack: () => void;
}) {
  const [draft, setDraft] = useState(() => Math.min(Math.max(Math.round(current), 1), Math.max(max, 1)));

  return (
    <TicketPageLayout
      footer={<ActionButton label={`Set ${draft}× leverage`} onPress={() => onApply(draft)} size="large" tone="accent" />}
      onBack={onBack}
      title="Leverage"
    >
      <LeverageStepper max={max} onChange={setDraft} value={draft} />
      <LeverageSlider max={max} min={1} onChange={setDraft} value={draft} />
      <TicketPanel style={styles.figures}>
        <TicketFigure label="Position size" value={positionSizeEstimate(collateral, draft)} />
        <TicketFigure label="Margin mode" value={marginMode === 'cross' ? 'Cross' : 'Isolated'} />
      </TicketPanel>
      {/* Said here, before it can fail, rather than only as the error review would raise. The venue keeps
          a market's leverage fixed while there is exposure on it, and this page is the one place a reader
          would otherwise pick a value that cannot be used. */}
      {hasExposure ? (
        <Text style={styles.note}>
          {`Open ${baseAsset} positions or orders fix leverage until they close. Review rejects a value that doesn't match them.`}
        </Text>
      ) : null}
    </TicketPageLayout>
  );
}

const styles = StyleSheet.create({
  figures: { gap: spacing.xxs, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  note: { ...typography.caption, color: colors.textMuted },
});
