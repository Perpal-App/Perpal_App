import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, gradients, radii, spacing, typography } from '@/theme/tokens';

/**
 * Shares of the available balance a reader can commit in one tap.
 *
 * The last is the whole balance and says `Max` rather than `100%`: it is the one people reach for by
 * meaning rather than by number.
 */
const PRESETS = [25, 50, 75, 100] as const;

const CHIP_HEIGHT = 36;

/**
 * The quick amounts, a row of neutral pills directly above the keypad they stand in for.
 *
 * Neutral on purpose. There is one accent on this ticket and it belongs to the action; a chosen preset
 * shows on its rim instead, which says "this one" without competing with what it is choosing for.
 */
export function PercentPresets({
  onSelect,
  selected,
}: {
  readonly onSelect: (percent: number) => void;
  readonly selected: number | null;
}) {
  return (
    <View style={styles.row}>
      {PRESETS.map((percent) => {
        const chosen = percent === selected;
        const max = percent === 100;
        return (
          <PressableScale
            accessibilityLabel={max ? 'Maximum available' : `${percent}% of available`}
            accessibilityRole="button"
            accessibilityState={{ selected: chosen }}
            key={percent}
            onPress={() => onSelect(percent)}
            pressedScale={0.95}
            style={[styles.chip, chosen && styles.chipChosen]}
          >
            <LinearGradient
              colors={gradients.surfaceRaise.colors}
              end={{ x: 0.5, y: 1 }}
              locations={gradients.surfaceRaise.locations}
              start={{ x: 0.5, y: 0 }}
              style={styles.fill}
            >
              <Text numberOfLines={1} style={[styles.label, chosen && styles.labelChosen]}>
                {max ? 'Max' : `${percent}%`}
              </Text>
            </LinearGradient>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
  // The rim is on the pressable and the ramp inside it clips to the same corner, so a chosen chip
  // changes a border colour and nothing about the gradient.
  chip: {
    flex: 1,
    minWidth: 0,
    height: CHIP_HEIGHT,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.pill,
  },
  chipChosen: { borderWidth: 1, borderColor: colors.accent },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { ...typography.caption, color: colors.textPrimary },
  labelChosen: { color: colors.accentSoft },
});
