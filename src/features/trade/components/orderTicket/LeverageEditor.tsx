import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { positionSizeEstimate } from '@/features/trade/components/PacificaOrderTicketFormatting';
import { LeverageSlider } from '@/features/trade/components/orderTicket/LeverageSlider';
import { LeverageStepper } from '@/features/trade/components/orderTicket/LeverageStepper';
import { TicketChips, type ChipOption } from '@/features/trade/components/orderTicket/TicketChips';
import { TicketFigure } from '@/features/trade/components/orderTicket/TicketFigure';
import type { TicketTone } from '@/features/trade/components/orderTicket/ticketTone';
import type { PacificaMarginMode } from '@/integrations/perps/pacifica/pacificaOrder';
import { colors, interfaceType, spacing } from '@/theme/tokens';

/** Round figures below the market's ceiling, offered as one-tap picks alongside the ceiling itself. */
const ROUND_PICKS = [2, 5, 10] as const;

/**
 * The leverage editor, inside the leverage card when it is open: the figure between two steppers, a slider
 * under it, a row of quick picks, and what the choice comes to.
 *
 * Controlled and live — a tap on a stepper, a chip or the rail is the ticket's leverage at once. A drag is
 * shown here as it goes, the figure rolling and the chips and position size following it, and becomes the
 * ticket's leverage once, when the finger lifts: only this editor redraws on each step, never the whole
 * ticket, which is what kept the figure from falling behind the thumb.
 *
 * Integers only, `1` to the market's maximum: that is what the order builder accepts, and a figure shown as
 * `10.0×` would promise a precision the venue does not take.
 */
export function LeverageEditor({
  baseAsset,
  collateral,
  hasExposure,
  marginMode,
  max,
  onChange,
  tone,
  value,
}: {
  readonly baseAsset: string;
  /** What is entered on the ticket, for the position size this leverage would make of it. */
  readonly collateral: string;
  /** An open position or order on this market, which pins leverage at the venue. */
  readonly hasExposure: boolean;
  readonly marginMode: PacificaMarginMode;
  readonly max: number;
  readonly onChange: (next: number) => void;
  readonly tone: TicketTone;
  readonly value: number;
}) {
  const picks = useMemo(() => leveragePicks(max), [max]);
  // The step a drag is passing through, until the finger lifts.
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? value;
  const commit = (next: number) => {
    setScrub(null);
    onChange(next);
  };

  return (
    <View style={styles.editor}>
      <LeverageStepper max={max} onChange={commit} value={shown} />
      <LeverageSlider max={max} min={1} onChange={commit} onScrub={setScrub} tone={tone} value={shown} />
      <TicketChips onSelect={commit} options={picks} selected={shown} tone={tone} />
      <View style={styles.figures}>
        <TicketFigure label="Position size" value={positionSizeEstimate(collateral, shown)} />
        <TicketFigure label="Margin mode" value={marginMode === 'cross' ? 'Cross' : 'Isolated'} />
      </View>
      {/* Said here, before it can fail, rather than only as the error review would raise. The venue keeps a
          market's leverage fixed while there is exposure on it. */}
      {hasExposure ? (
        <Text style={styles.note}>
          {`Open ${baseAsset} positions or orders fix leverage until they close. Review rejects a value that doesn't match them.`}
        </Text>
      ) : null}
    </View>
  );
}

/** `2× 5× 10×` under the ceiling, then the ceiling: four picks on most markets, fewer on a low one. */
function leveragePicks(max: number): readonly ChipOption[] {
  const values = [...new Set([...ROUND_PICKS.filter((pick) => pick < max), Math.max(1, max)])];
  return values.map((pick) => ({ label: `${pick}×`, spoken: `${pick}× leverage`, value: pick }));
}

const styles = StyleSheet.create({
  // One even step between the four parts. The slider carries its own touch height around a 4pt rail, and the
  // stepper its 48pt buttons, so a larger gap only doubled room that was already there.
  editor: { gap: spacing.sm },
  figures: { gap: spacing.xxs },
  note: { ...interfaceType.caption, color: colors.textMuted },
});
