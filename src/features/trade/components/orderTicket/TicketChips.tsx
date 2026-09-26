import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/ui/PressableScale';
import { TICKET_TONES, type TicketTone } from '@/features/trade/components/orderTicket/ticketTone';
import { colors, gradients, motion, radii, spacing, typography } from '@/theme/tokens';

const CHIP_HEIGHT = 36;
const GAP = spacing.xs;

/**
 * How strongly the chosen chip is tinted. A wash light enough that the chip's own material still reads
 * through it, and a rim at half strength: together they say "this one" without turning the chip into a
 * solid block of the side's colour.
 */
const WASH_OPACITY = 0.14;
const RIM_OPACITY = 0.55;
/** A first choice grows into place from just under full size; a cleared one shrinks away. */
const ENTER_SCALE = 0.9;
/** The app's morph spring: settled in about a third of a second, with no visible overshoot at this size. */
const SPRING = motion.layoutMorph;

export type ChipOption = {
  readonly label: string;
  /** What a screen reader says, where the visible label is shorthand — `Max`, `5×`. */
  readonly spoken: string;
  readonly value: number;
};

/**
 * A row of quick values — the collateral presets, the leverage picks — with one highlight that moves
 * between them.
 *
 * Built like a segmented control. The pills are one layer, the labels another, and a single highlight sits
 * between the two and slides from the old choice to the new on the morph spring, rather than one chip
 * switching off and another switching on. Each label takes the tone by how close the highlight is to it,
 * so the colour travels across with it. A first choice grows into place where it lands; clearing the choice
 * lets the highlight shrink and fade where it was. A tap gives one selection tick on iOS.
 *
 * Transform and opacity only, on the UI thread. The chips are equal widths, so where the highlight goes is a
 * translation of the chip index — nothing is measured per chip, and nothing is re-laid out as it moves.
 * Under reduce motion the highlight and the colours change in place.
 */
export function TicketChips({
  onSelect,
  options,
  selected,
  tone,
}: {
  readonly onSelect: (value: number) => void;
  readonly options: readonly ChipOption[];
  readonly selected: number | null;
  readonly tone: TicketTone;
}) {
  const reduceMotion = useReducedMotion();
  const marked = TICKET_TONES[tone];
  const index = options.findIndex((option) => option.value === selected);
  const [chipWidth, setChipWidth] = useState(0);
  // Chip width plus the gap: how far the highlight travels per chip.
  const slot = useSharedValue(0);
  const position = useSharedValue(Math.max(index, 0));
  const shown = useSharedValue(index >= 0 ? 1 : 0);
  const previous = useRef(index);

  useEffect(() => {
    const from = previous.current;
    previous.current = index;
    if (index < 0) {
      shown.set(reduceMotion ? 0 : withSpring(0, SPRING));
      return;
    }
    // A change between two choices slides; a first choice appears where it is, with nothing to slide from.
    position.set(from < 0 || reduceMotion ? index : withSpring(index, SPRING));
    shown.set(reduceMotion ? 1 : withSpring(1, SPRING));
  }, [index, position, reduceMotion, shown]);

  const onLayout = (event: LayoutChangeEvent) => {
    const width = (event.nativeEvent.layout.width - GAP * (options.length - 1)) / options.length;
    setChipWidth(width);
    slot.set(width + GAP);
  };

  const highlightStyle = useAnimatedStyle(() => ({
    opacity: Math.min(Math.max(shown.value, 0), 1),
    transform: [
      { translateX: position.value * slot.value },
      { scale: ENTER_SCALE + (1 - ENTER_SCALE) * shown.value },
    ],
  }));

  const choose = (value: number) => {
    if (Platform.OS === 'ios') void Haptics.selectionAsync();
    onSelect(value);
  };

  return (
    <View onLayout={onLayout} style={styles.row}>
      {options.map((option) => (
        <View key={option.value} style={styles.pill}>
          <LinearGradient
            colors={gradients.surfaceRaise.colors}
            end={{ x: 0.5, y: 1 }}
            locations={gradients.surfaceRaise.locations}
            start={{ x: 0.5, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ))}

      {chipWidth > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.highlight, { width: chipWidth }, highlightStyle]}>
          <View style={[styles.wash, { backgroundColor: marked.rim }]} />
          <View style={[styles.rim, { borderColor: marked.rim }]} />
        </Animated.View>
      ) : null}

      <View style={styles.labels}>
        {options.map((option, chip) => (
          <ChipLabel
            index={chip}
            ink={marked.ink}
            key={option.value}
            label={option.label}
            onPress={() => choose(option.value)}
            position={position}
            selected={chip === index}
            shown={shown}
            spoken={option.spoken}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * One chip's label and touch target, drawn twice — plain, and in the tone — with the tinted copy showing as
 * much as the highlight is over this chip. Crossfaded by opacity, so the colour moves without a colour
 * animation and without any text being re-laid out.
 */
function ChipLabel({
  index,
  ink,
  label,
  onPress,
  position,
  selected,
  shown,
  spoken,
}: {
  readonly index: number;
  readonly ink: string;
  readonly label: string;
  readonly onPress: () => void;
  readonly position: SharedValue<number>;
  readonly selected: boolean;
  readonly shown: SharedValue<number>;
  readonly spoken: string;
}) {
  const tintStyle = useAnimatedStyle(() => ({ opacity: nearness(position.value, shown.value, index) }));
  const plainStyle = useAnimatedStyle(() => ({ opacity: 1 - nearness(position.value, shown.value, index) }));

  return (
    <PressableScale
      accessibilityLabel={spoken}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      pressedScale={0.94}
      style={styles.cell}
    >
      <View>
        <Animated.Text numberOfLines={1} style={[styles.label, plainStyle]}>{label}</Animated.Text>
        <Animated.Text numberOfLines={1} style={[styles.label, styles.tint, { color: ink }, tintStyle]}>
          {label}
        </Animated.Text>
      </View>
    </PressableScale>
  );
}

/** How much of the highlight is over chip `index`: 1 on it, 0 a chip or more away, and nothing while hidden. */
function nearness(position: number, shown: number, index: number): number {
  'worklet';
  const over = Math.min(Math.max(1 - Math.abs(position - index), 0), 1);
  return over * Math.min(Math.max(shown, 0), 1);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP },
  // The pill is a plain view holding the clip and the rim; the gradient inside it never changes. Corners and
  // clipping on a third-party native view are the least reliable path on Android, on a `View` the most.
  pill: {
    flex: 1,
    minWidth: 0,
    height: CHIP_HEIGHT,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.pill,
  },
  highlight: { position: 'absolute', top: 0, left: 0, height: CHIP_HEIGHT },
  wash: { position: 'absolute', inset: 0, borderRadius: radii.pill, opacity: WASH_OPACITY },
  rim: { position: 'absolute', inset: 0, borderWidth: 1, borderRadius: radii.pill, opacity: RIM_OPACITY },
  // Over the pills and the highlight, laid out exactly as the pills are, so each label and its touch target
  // sit on their own chip.
  labels: { position: 'absolute', inset: 0, flexDirection: 'row', gap: GAP },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.caption, color: colors.textPrimary, textAlign: 'center' },
  // Exactly over the plain copy: same face, same box.
  tint: { position: 'absolute', top: 0, left: 0, right: 0 },
});
