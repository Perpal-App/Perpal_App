import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import { colors, fonts, gradients, layout, radii, spacing, typography } from '@/theme/tokens';

/**
 * Search input as a rounded, raised card.
 *
 * Inset to the screen gutter so its edges line up with the heading above it and
 * the column header below it, and filled with the shallow neutral ramp those share:
 * a lit top edge over a deeper base, rimmed on all four sides, so a control the
 * user types into reads as raised out of the page rather than cut into it.
 */
export function SearchField({
  compact = false,
  onChangeText,
  placeholder,
  value,
}: {
  readonly compact?: boolean;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
}) {
  return (
    <View style={[styles.band, compact && styles.compactGutter]}>
      <LinearGradient
        colors={gradients.surfaceRaise.colors}
        end={{ x: 0.5, y: 1 }}
        locations={gradients.surfaceRaise.locations}
        start={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <SearchGlyph />
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="characters"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        selectionColor={colors.accent}
        // No lineHeight on an input: Android derives the caret box from the
        // font's own metrics and a forced line clips the typed text.
        style={styles.input}
        value={value}
      />
      {value.length === 0 ? null : (
        <Pressable
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => onChangeText('')}
          style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
        >
          <ClearGlyph />
        </Pressable>
      )}
    </View>
  );
}

function SearchGlyph() {
  return (
    <Svg height={16} viewBox="0 0 24 24" width={16}>
      <Circle
        cx="10.5"
        cy="10.5"
        fill="none"
        r="6.5"
        stroke={colors.textMuted}
        strokeWidth={1.8}
      />
      <Line
        stroke={colors.textMuted}
        strokeLinecap="round"
        strokeWidth={1.8}
        x1="15.5"
        x2="20"
        y1="15.5"
        y2="20"
      />
    </Svg>
  );
}

function ClearGlyph() {
  return (
    <Svg height={14} viewBox="0 0 24 24" width={14}>
      <Line
        stroke={colors.textSecondary}
        strokeLinecap="round"
        strokeWidth={2}
        x1="6"
        x2="18"
        y1="6"
        y2="18"
      />
      <Line
        stroke={colors.textSecondary}
        strokeLinecap="round"
        strokeWidth={2}
        x1="18"
        x2="6"
        y1="6"
        y2="18"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // A box with rounded corners, inset to the same line as the column header card
  // below it and separated from it, so the two read as two controls rather than as
  // one shape cut in half.
  band: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    overflow: 'hidden',
    marginHorizontal: layout.screenPadding - spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.xs,
  },
  compactGutter: { marginHorizontal: layout.screenPaddingCompact - spacing.xs },
  input: {
    ...typography.bodyCompact,
    // The token's lineHeight is dropped deliberately; see the note on the input.
    lineHeight: undefined,
    fontFamily: fonts.regular,
    flex: 1,
    minWidth: 0,
    minHeight: layout.minTouchTarget - spacing.xs,
    color: colors.textPrimary,
  },
  clear: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.72 },
});
