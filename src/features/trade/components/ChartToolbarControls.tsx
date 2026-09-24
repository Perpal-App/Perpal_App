import { Pressable, StyleSheet, Text } from 'react-native';

import {
  ChartToolIcon,
  type ChartToolName,
} from '@/features/trade/components/ChartToolIcon';
import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Footprint of a square icon control, and therefore the width of the drawing rail — a rail is a
 * column of these, so one number sizes both and they cannot drift apart.
 */
export const CHART_ICON_SIZE = 40;

/**
 * Text scale cap on a fixed-width chip.
 *
 * A chip that is told its width cannot grow to fit a larger label, so the label is capped instead of
 * being allowed to clip. 1.3 is where the widest interval on the strip — `30m`, 27.3pt in Poppins
 * Medium at 12 — reaches 35.5pt and still clears the 40pt box.
 *
 * The cap applies only to the strip. Every interval is also in the overflow menu, whose rows are
 * `AnchoredMenu`'s and scale without limit, so nothing is unreachable at a large text setting.
 */
const FIXED_CHIP_FONT_CAP = 1.3;

/**
 * A labelled chart control: an interval on the strip, a series toggle under the chart.
 *
 * `width` is what separates the two uses. Left off, the chip sizes to its label and is free to grow
 * with the text setting — right for the row under the chart, which wraps rather than cropping. Given,
 * the chip is exactly that wide, which is what lets the strip above the chart work out how many
 * intervals fit from its own measured width instead of guessing.
 */
export function ToolButton({
  label,
  onPress,
  selected = false,
  width,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly selected?: boolean;
  readonly width?: number;
}) {
  const fixed = width !== undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        fixed ? { width, paddingHorizontal: 0 } : null,
        selected && styles.toolSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text
        maxFontSizeMultiplier={fixed ? FIXED_CHIP_FONT_CAP : undefined}
        numberOfLines={1}
        style={[styles.toolText, selected && styles.toolTextSelected]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A square chart control carrying a mark instead of a word. */
export function IconButton({
  icon,
  label,
  onPress,
  selected = false,
}: {
  readonly icon: ChartToolName;
  readonly label: string;
  readonly onPress: () => void;
  readonly selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconTool,
        selected && styles.toolSelected,
        pressed && styles.pressed,
      ]}
    >
      <ChartToolIcon color={selected ? colors.accentSoft : colors.textMuted} name={icon} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tool: {
    minWidth: 44,
    minHeight: CHART_ICON_SIZE,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  iconTool: {
    width: CHART_ICON_SIZE,
    height: CHART_ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  toolSelected: { backgroundColor: colors.surfaceElevated },
  toolText: { ...typography.caption, color: colors.textMuted },
  toolTextSelected: { color: colors.textPrimary },
  pressed: { opacity: 0.72 },
});
