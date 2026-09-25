import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { PressableScale } from '@/components/ui/PressableScale';
import { RaisedMaterial } from '@/components/ui/RaisedMaterial';
import { colors, gradients, radii, spacing, typography } from '@/theme/tokens';

/**
 * Compact by intent: tall enough to hit, short enough to leave the data room.
 *
 * A floor rather than a fixed height. The button is sized by its own label plus the fill's padding and
 * only falls back to this when that comes out shorter, which is every normal text size — so it
 * measures exactly this today and grows rather than clips when the reader scales type up.
 */
const MIN_HEIGHT = 42;

export type ActionButtonTone = 'accent' | 'negative' | 'neutral' | 'positive';

/**
 * The four materials an action can be cut from: a solid fill, a label colour, a halo, and how much
 * specular the fill can absorb.
 *
 * A colour and not a ramp, which is the fix for a selected button coming up as a flat block with no
 * label on it. The modelling that used to live in a three-stop gradient now comes from `RaisedMaterial`,
 * whose two overlays are identical for every tone — so choosing an option changes a `backgroundColor`
 * and an opacity and touches no native gradient prop. `expo-linear-gradient`'s Android view rebuilds its
 * shader from two separate setters and abandons the rebuild whenever `colors` and `locations` disagree in
 * length; a gradient asked to change its stop count at runtime is a gradient that can be left drawing
 * nothing, and swapping between the three-stop accent ramp and the two-stop grey one did exactly that.
 *
 * `fill` is each old ramp's deepest stop rather than a new colour, so every button keeps the tone it
 * had — the sheen supplies the lit top edge the first stop used to be, and the shade supplies the belly.
 *
 * The lit three carry no border. They were rimmed a step darker on all four sides, and that rim was why
 * they read as flat: an even outline traces a shape instead of shading it, and light does not arrive from
 * four directions. `neutral` keeps its border, because on a near-black page that border is the only thing
 * separating a dark grey control from the page. Its specular runs at a quarter strength for the same
 * reason, and its halo is the app's dark contact shadow rather than a coloured glow — grey does not emit
 * light.
 */
const TONES = {
  accent: {
    fill: gradients.accentAction.colors[1],
    glow: colors.accent,
    label: colors.onAccent,
    rim: null,
    sheen: 1,
  },
  negative: {
    fill: gradients.shortAction.colors[1],
    glow: colors.negative,
    label: colors.onAccent,
    rim: null,
    sheen: 1,
  },
  neutral: {
    fill: gradients.surfaceRaise.colors[1],
    glow: colors.raisedHalo,
    label: colors.textPrimary,
    rim: colors.border,
    sheen: 0.28,
  },
  positive: {
    fill: gradients.longAction.colors[1],
    glow: colors.positive,
    label: colors.onLight,
    rim: null,
    sheen: 1,
  },
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
  glow = false,
  label,
  loading = false,
  onPress,
  radius,
  selected,
  size = 'regular',
  style,
  tone = 'accent',
}: {
  readonly accessibilityHint?: string;
  readonly disabled?: boolean;
  /**
   * Lifts the button off the page on a soft halo of its own colour.
   *
   * Opt-in, because a glow on every action in the app would be a different design — it is for a
   * control floating over content, where nothing else separates it from what is scrolling past
   * underneath. A tone's halo is its own saturated hue rather than black, so a Buy button throws
   * green: on a near-black page that reads as the button emitting light, which is what makes it sit in
   * front of the page rather than on it.
   *
   * Kept tight — 10pt of blur against the 12pt gap between a pair — so it stays a rim of light rather
   * than a bloom, and so two of them side by side do not muddy each other in the gap.
   *
   * Android draws `elevation` shadows in the requested colour from API 28. Below that it falls back to
   * black, which is the contact shadow this replaced.
   */
  readonly glow?: boolean;
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
  /**
   * Overrides the corner. Defaults to the app's action radius; pass a rounder one where a whole
   * surface of controls needs to agree with a softer container than the page — the withdraw sheet
   * sits inside a `radii.panel` shell, and at the default its buttons read as hard against it.
   */
  readonly radius?: number;
  /**
   * `large` for a screen's primary action — a pinned pair that is the point of the screen rather than
   * a control beside its data. Taller, with the `action` type role and a wider fill inset.
   */
  readonly size?: 'regular' | 'large';
  readonly style?: StyleProp<ViewStyle>;
  readonly tone?: ActionButtonTone;
}) {
  const material = TONES[tone];
  const unavailable = disabled || loading;
  const large = size === 'large';
  // One corner value for both layers. The ramp carries its own radius rather than being clipped by the
  // button, so the two have to be told the same number or the fill's corner shows through the halo's.
  const corner = radius ?? radii.sm;

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
      style={[
        styles.button,
        large && styles.buttonLarge,
        // The colour is on both layers on purpose. The fill below needs it to be seen; this one needs it
        // because Android's `elevation` throws no shadow from a view with no background, and the halo
        // lives here. Taken from the same token, so they cannot disagree.
        { backgroundColor: material.fill, borderRadius: corner },
        glow ? [styles.glow, { shadowColor: material.glow }] : null,
        unavailable && styles.disabled,
        style,
      ]}
    >
      {/* A plain view holds the colour, the corner, the clip and the label. The modelling is two fixed
          overlays behind the label, not a container around it.

          1. The clip has to be off the pressable, because `overflow: 'hidden'` sets `masksToBounds` and
             a masked layer throws no shadow on iOS — which is why the contact shadow this pair used to
             carry was never visible there.
          2. The clip has to be a React Native view rather than a gradient. `overflow` and `borderRadius`
             on a third-party native view are the platform's least-tested path; on a `View` they are the
             most-tested one.
          3. The label must not be inside a gradient. Whatever a gradient view does or fails to do with
             its shader, the text is a sibling and renders regardless. */}
      <View
        // Fabric can retain a clipped Android view's display list while its background, border and
        // descendants are restyled in one commit. The symptom is unusually specific: accessibility
        // still sees the TextView at the right bounds and at drawing order 3, but the frame contains
        // only the new background. Remount the material boundary when the tone changes rather than
        // asking that native view to mutate between the two display lists. The pressable stays mounted,
        // so gesture state and accessibility focus do not move.
        collapsable={false}
        key={tone}
        style={[
          styles.fill,
          large && styles.fillLarge,
          { backgroundColor: material.fill, borderRadius: corner },
          material.rim === null ? null : { borderColor: material.rim, borderWidth: 1 },
        ]}
      >
        <RaisedMaterial sheen={material.sheen} />

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
            style={[large ? styles.labelLarge : styles.label, { color: material.label }]}
          >
            {label}
          </Text>
        )}
      </View>
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
  // A minimum rather than a fixed height, so the button grows with the reader's text size instead of
  // clipping its own label. At normal scale the label's line plus the fill's padding comes to less
  // than the minimum, so it still measures exactly `MIN_HEIGHT` and nothing on any existing screen
  // moves — the flexibility only shows up where it is needed.
  //
  // Not clipped, and carries no border. Both moved to the fill inside it: this layer's only jobs are
  // the height and the halo, and a layer that clips cannot cast one.
  button: {
    minHeight: MIN_HEIGHT,
    borderCurve: 'continuous',
  },
  // Legacy `shadow*` plus `elevation` rather than `boxShadow`, which is the better API but needs the
  // New Architecture and fails silently without it. `shadowColor` is supplied per tone.
  glow: {
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 8,
  },
  // 52 against the regular 42. Still a minimum, so the same growth-not-clipping rule applies: the
  // `action` label's line plus the fill's padding comes to 40, which leaves the height to the minimum
  // at normal scale and to the label past it.
  buttonLarge: { minHeight: 52 },
  // Rounds and clips itself rather than relying on the parent, so the halo above stays unmasked. It also
  // holds the label, which the gradients behind it deliberately do not.
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderCurve: 'continuous',
  },
  fillLarge: { paddingHorizontal: spacing.md },
  label: { ...typography.label, textAlign: 'center' },
  labelLarge: { ...typography.action, textAlign: 'center' },
  disabled: { opacity: 0.4 },
});
