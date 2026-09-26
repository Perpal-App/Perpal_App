import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  pnlFigure,
  spokenPnl,
  type PnlFigure,
} from '@/features/trade/components/orderTicket/autoClosePnl';
import { entryText } from '@/features/trade/components/orderTicket/keypadEntry';
import { KeypadAmount } from '@/features/trade/components/orderTicket/KeypadAmount';
import { PnlIndicator } from '@/features/trade/components/orderTicket/PnlIndicator';
import { TICKET_TONES } from '@/features/trade/components/orderTicket/ticketTone';
import { colors, motion, radii, spacing, typography } from '@/theme/tokens';

/**
 * How strongly the field being typed into is marked in its own colour. The same restraint as the chips: a
 * faint wash and a rim a little under full strength, so the field reads as chosen without becoming a block
 * of green or red.
 */
const WASH_OPACITY = 0.08;
const RIM_OPACITY = 0.7;

/**
 * One auto-close price, half the width of the card: the figure, and what it would come to under it.
 *
 * Each price owns a colour, take profit green and stop loss red, on its label and on its rim while it is
 * the one the keypad is typing into. Moving between the two cross-fades the marking from one field to the
 * other rather than switching it.
 *
 * Under the figure is the estimated profit or loss at that price and nothing else: no instructions, no
 * percentages. Its caret and colour carry the check a hint used to, so a take profit that would lose money
 * reads as a loss while it is being typed. The line is always laid out and only fades in once there is a
 * price, so the first digit never moves the field, the card, or the keypad under them.
 *
 * When the card is left with the price wrong, the order builder's reason appears under the field and the rim
 * turns to the loss colour, so the problem is never carried by colour alone.
 */
export function TriggerPriceField({
  active,
  entry,
  error,
  hint,
  label,
  onPress,
  pnl,
  rejectSignal,
  spokenLabel,
  tone,
}: {
  readonly active: boolean;
  readonly entry: string;
  readonly error: string | null;
  /** Which side of the mark the price belongs on, e.g. `Above mark`. Spoken only, never drawn. */
  readonly hint: string;
  readonly label: string;
  readonly onPress: () => void;
  /** Estimated profit or loss at this price, in USDC base units, or `null` when it cannot be estimated. */
  readonly pnl: bigint | null;
  readonly rejectSignal: number;
  readonly spokenLabel: string;
  readonly tone: 'negative' | 'positive';
}) {
  const reduceMotion = useReducedMotion();
  const ink = TICKET_TONES[tone].rim;
  const invalid = error !== null;
  const hasPrice = entry.length > 0;
  const marked = useSharedValue(active ? 1 : 0);
  const priced = useSharedValue(hasPrice ? 1 : 0);

  useEffect(() => {
    const target = active || invalid ? 1 : 0;
    marked.set(reduceMotion ? target : withTiming(target, { duration: motion.rowSwap.fadeMs }));
  }, [active, invalid, marked, reduceMotion]);

  useEffect(() => {
    const target = hasPrice ? 1 : 0;
    priced.set(reduceMotion ? target : withTiming(target, { duration: motion.rowSwap.fadeMs }));
  }, [hasPrice, priced, reduceMotion]);

  const washStyle = useAnimatedStyle(() => ({ opacity: marked.value * WASH_OPACITY }));
  const rimStyle = useAnimatedStyle(() => ({ opacity: marked.value * (invalid ? 1 : RIM_OPACITY) }));
  const outcomeStyle = useAnimatedStyle(() => ({ opacity: priced.value }));

  const value = hasPrice ? `$${entryText(entry)}` : 'not set';
  const figure = pnl === null ? null : pnlFigure(pnl);
  const spoken = hasPrice ? `${spokenLabel}, ${value}, ${spokenEstimate(figure)}` : `${spokenLabel}, ${value}`;

  return (
    <View style={styles.column}>
      <Pressable
        accessibilityHint={`${hint}. The keypad types into the selected price.`}
        accessibilityLabel={spoken}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={onPress}
        style={styles.field}
      >
        <Animated.View pointerEvents="none" style={[styles.layer, { backgroundColor: ink }, washStyle]} />
        <Animated.View
          pointerEvents="none"
          style={[styles.layer, styles.rim, { borderColor: invalid ? colors.negative : ink }, rimStyle]}
        />
        <Text numberOfLines={1} style={[styles.eyebrow, { color: ink }]}>{label}</Text>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {/* A row, because the figure's box flexes along its parent's main axis to take the width. */}
          <View style={styles.row}>
            <KeypadAmount accessibilityLabel={value} entry={entry} rejectSignal={rejectSignal} size="field" />
          </View>
          <Animated.View style={outcomeStyle}>
            <PnlIndicator figure={figure} />
          </Animated.View>
        </View>
      </Pressable>
      {invalid ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>{error}</Text>
      ) : null}
    </View>
  );
}

/** The estimate in words, for the field's spoken label. */
function spokenEstimate(figure: PnlFigure | null): string {
  return figure === null ? 'enter an amount to estimate profit or loss' : spokenPnl(figure);
}

const styles = StyleSheet.create({
  column: { flex: 1, minWidth: 0, gap: spacing.xxs },
  // Recessed into the card: the sheet's own surface, a shade under the card's ramp. Clipped, so the wash and
  // the rim laid over it take its corners.
  //
  // No gap between the three lines. Each already leads at 1.5x, and that leading puts about 12pt between
  // one line's baseline and the next line's cap height, which matches the padding at the top and bottom.
  field: {
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
  },
  layer: { position: 'absolute', inset: 0, borderRadius: radii.sm },
  rim: { borderWidth: 1 },
  eyebrow: { ...typography.eyebrow, letterSpacing: 0.5 },
  row: { flexDirection: 'row' },
  error: { ...typography.caption, color: colors.negative },
});
