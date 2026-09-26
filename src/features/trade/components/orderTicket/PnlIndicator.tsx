import { StyleSheet, Text } from 'react-native';

import {
  signedDollars,
  type PnlDirection,
  type PnlFigure,
} from '@/features/trade/components/orderTicket/autoClosePnl';
import { colors, interfaceType } from '@/theme/tokens';

/** A long amount shrinks to fit rather than being cut off, down to this share. */
const MIN_FIT = 0.75;

/** The colour of an estimate: the gain or the loss colour, and muted for one that comes to nothing. */
export const PNL_INK: Readonly<Record<PnlDirection, string>> = {
  flat: colors.textMuted,
  gain: colors.positive,
  loss: colors.negative,
};

/**
 * An estimated profit or loss as a signed figure in its colour: `+$91.50` in green, `−$3.07` in red.
 *
 * The sign says which it is, so the figure never relies on colour alone. A flat estimate has no sign and is
 * muted; one that cannot be made yet, with a price but no amount to size it from, is the app's `--`.
 */
export function PnlIndicator({
  figure,
  maxFontSizeMultiplier,
}: {
  readonly figure: PnlFigure | null;
  /** For an indicator inside a header whose text stops scaling at a ceiling: the same ceiling. */
  readonly maxFontSizeMultiplier?: number;
}) {
  return (
    <Text
      adjustsFontSizeToFit
      {...(maxFontSizeMultiplier === undefined ? null : { maxFontSizeMultiplier })}
      minimumFontScale={MIN_FIT}
      numberOfLines={1}
      style={[styles.value, { color: PNL_INK[figure?.direction ?? 'flat'] }]}
    >
      {figure === null ? '--' : signedDollars(figure)}
    </Text>
  );
}

const styles = StyleSheet.create({
  // `flexShrink` and `minWidth: 0` give the fit a width to shrink the amount into.
  value: { ...interfaceType.figureStrong, flexShrink: 1, minWidth: 0 },
});
