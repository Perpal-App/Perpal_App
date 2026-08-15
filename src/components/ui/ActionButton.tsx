import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { PressableScale } from '@/components/ui/PressableScale';
import { colors, gradients, radii, typography } from '@/theme/tokens';

/** Compact by intent: tall enough to hit, short enough to leave the data room. */
const HEIGHT = 42;

export type ActionButtonTone = 'accent' | 'negative' | 'neutral' | 'positive';

/**
 * The four materials an action can be cut from.
 *
 * Every one is the same construction — a ramp from a lit top edge to a deeper base, rimmed one step
 * darker on all four sides — which is what gives a short button its dimension: the fill reads as a
 * curved surface catching light rather than as a flat block of colour.
 *
 * `positive` and `negative` are the order sides. `accent` is the primary action anywhere that is not
 * a trade. `neutral` is the secondary beside it, built from the same raised grey the search field
 * and the markets table header use, so a secondary action is quiet without being a hole.
 *
 * Left to infer rather than annotated: `LinearGradient` wants its stops as tuples of at least two
 * entries, and widening them through a record type is enough to lose that and fail the call.
 */
const TONES = {
  accent: { edge: colors.accentEdge, label: colors.onAccent, ramp: gradients.accentAction },
  negative: { edge: colors.shortEdge, label: colors.onAccent, ramp: gradients.shortAction },
  neutral: { edge: colors.border, label: colors.textPrimary, ramp: gradients.surfaceRaise },
  positive: { edge: colors.longEdge, label: colors.onLight, ramp: gradients.longAction },
} as const;

/**
 * The app's action button.
 *
 * One primitive for every raised action so a buy button, a deposit, and a cancel are visibly the
 * same kind of object with different weight. It was the order bar's private `SideButton` first;
 * promoting it is what let the portfolio screen stop drawing its own.
 *
 * Distinct from `Button`, which is the taller form CTA used on empty states and modal footers. This
 * one is for a row of actions sitting next to data, where a 56pt control would take the space the
 * data needs.
 */
export function ActionButton({
  accessibilityHint,
  disabled = false,
  label,
  loading = false,
  onPress,
  selected,
  style,
  tone = 'accent',
}: {
  readonly accessibilityHint?: string;
  readonly disabled?: boolean;
  readonly label: string;
  /** Swaps the label for a spinner and blocks the press, for an action already in flight. */
  readonly loading?: boolean;
  readonly onPress: () => void;
  /**
   * Set on a button that is one of a set of choices rather than a standalone action.
   *
   * It changes nothing visually — the caller already picks the tone — but it turns the control into a
   * radio for assistive tech. Without it the accent fill is the only thing saying which of two
   * destinations is chosen, and a fill is not something a screen reader can read.
   */
  readonly selected?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly tone?: ActionButtonTone;
}) {
  const material = TONES[tone];
  const unavailable = disabled || loading;

  return (
    <PressableScale
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityState={selected === undefined
        ? { busy: loading, disabled: unavailable }
        : { busy: loading, checked: selected, disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      // Shallower than the app's default press. These sit in pairs, and at 4% the gap between two
      // buttons visibly opens when either one is held.
      pressedScale={0.98}
      style={[styles.button, { borderColor: material.edge }, unavailable && styles.disabled, style]}
    >
      <LinearGradient
        colors={material.ramp.colors}
        end={{ x: 0.5, y: 1 }}
        locations={material.ramp.locations}
        start={{ x: 0.5, y: 0 }}
        style={styles.fill}
      >
        {loading ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <IOSLoader color={material.label} />
          </View>
        ) : (
          // One capped line, always. A button in a row of two that wraps to a second line becomes
          // taller than its neighbour, and the pair stops reading as a pair — which is the whole
          // reason this is `numberOfLines={1}` and the height is fixed rather than intrinsic.
          <Text
            maxFontSizeMultiplier={MAX_TEXT_SCALE}
            numberOfLines={1}
            style={[styles.label, { color: material.label }]}
          >
            {label}
          </Text>
        )}
      </LinearGradient>
    </PressableScale>
  );
}

/**
 * How far button text follows the reader's text-size setting.
 *
 * Capped, because the height is fixed: past this the label would be clipped vertically, which is
 * worse than slightly smaller type. Keep labels short enough that this cap is never reached.
 */
const MAX_TEXT_SCALE = 1.2;

const styles = StyleSheet.create({
  // Clipped, so the ramp takes the corners. Rimmed at a full point rather than a hairline, which is
  // what makes the edge read as the side of a raised surface instead of an outline around it.
  button: {
    height: HEIGHT,
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: radii.sm,
    borderCurve: 'continuous',
  },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.label },
  disabled: { opacity: 0.4 },
});
