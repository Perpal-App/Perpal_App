import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

/** Expands each tab's touch area vertically without inflating the strip. */
const TAB_HIT_SLOP = { top: spacing.xs, bottom: spacing.xs, left: 0, right: 0 };

/** Thickness of the active tab's rule. Reads clearly over a hairline divider. */
const ACTIVE_RULE = 2;

export type UnderlineTabOption = {
  readonly id: string;
  readonly label: string;
};

/**
 * Scrollable tab strip where selection is an accent rule under the active label.
 *
 * The strip is meant to sit directly on the hairline of whatever it filters, so
 * the rule lands on that line and ties the two together. Callers pass their own
 * `contentStyle` for the gutter, which lets the strip span the full screen while
 * its first tab still lines up with the content beside it.
 */
export function UnderlineTabs({
  contentStyle,
  onSelect,
  options,
  selectedId,
}: {
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly onSelect: (id: string) => void;
  readonly options: readonly UnderlineTabOption[];
  readonly selectedId: string;
}) {
  return (
    <View accessibilityRole="tablist">
      <ScrollView
        contentContainerStyle={[styles.strip, contentStyle]}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {options.map((option) => {
          const selected = option.id === selectedId;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              hitSlop={TAB_HIT_SLOP}
              key={option.id}
              onPress={() => onSelect(option.id)}
              style={({ pressed }) => [
                styles.tab,
                selected && styles.tabSelected,
                pressed && styles.pressed,
              ]}
            >
              {/* No text-scale cap: the strip scrolls, so a tab is free to grow
                  as wide as the reader's text size needs. */}
              <Text
                numberOfLines={1}
                style={selected ? styles.labelSelected : styles.label}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { alignItems: 'flex-end', gap: spacing.md },
  tab: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    // Reserved on every tab so the rule appears without moving the label.
    borderBottomWidth: ACTIVE_RULE,
    borderBottomColor: 'transparent',
  },
  tabSelected: { borderBottomColor: colors.accent },
  label: { ...typography.label, color: colors.textMuted },
  // The active label takes the accent too, a shade lighter than its rule, so
  // selection reads from both the rule and the label, never from colour alone.
  labelSelected: { ...typography.label, color: colors.accentSoft },
  pressed: { opacity: 0.72 },
});
