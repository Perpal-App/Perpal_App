import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { PnlDirection, PnlFigure } from '@/features/trade/components/orderTicket/autoClosePnl';
import { colors, typography } from '@/theme/tokens';

/** About the figure's cap height, so the caret reads as part of the number rather than an icon beside it. */
const CARET = 12;

/** A long amount shrinks to fit a half-width field rather than being cut off, down to this share. */
const MIN_FIT = 0.75;

const INK: Readonly<Record<PnlDirection, string>> = {
  flat: colors.textMuted,
  gain: colors.positive,
  loss: colors.negative,
};

const CARETS = { gain: 'caret-up', loss: 'caret-down' } as const;

/**
 * An estimated profit or loss: a caret and the amount, both in the gain or the loss colour.
 *
 * The caret says which it is, up for a profit and down for a loss, so the figure never relies on colour
 * alone and the amount beside it stays unsigned. A flat estimate has no caret and is muted. One that cannot
 * be made yet (a price, but no amount to size it from) is the app's `--`, muted too.
 *
 * Set in Poppins SemiBold, the ticket's figure face: the bundled geometric family, whose round bowls and
 * open counters keep a small number soft and legible.
 */
export function PnlIndicator({
  figure,
  maxFontSizeMultiplier,
}: {
  readonly figure: PnlFigure | null;
  /** For an indicator inside a header whose text stops scaling at a ceiling: the same ceiling. */
  readonly maxFontSizeMultiplier?: number;
}) {
  const direction = figure?.direction ?? 'flat';
  const ink = INK[direction];

  return (
    <View style={styles.row}>
      {direction === 'flat' ? null : <Ionicons color={ink} name={CARETS[direction]} size={CARET} />}
      <Text
        adjustsFontSizeToFit
        {...(maxFontSizeMultiplier === undefined ? null : { maxFontSizeMultiplier })}
        minimumFontScale={MIN_FIT}
        numberOfLines={1}
        style={[styles.value, { color: ink }]}
      >
        {figure === null ? '--' : figure.dollars}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Tight to the figure, the way a sign sits against a number; the glyph's own side bearing adds the rest.
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  // `flexShrink` and `minWidth: 0` give the fit a width to shrink the amount into.
  value: { ...typography.label, flexShrink: 1, minWidth: 0 },
});
