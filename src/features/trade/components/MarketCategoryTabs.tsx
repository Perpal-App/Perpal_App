import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, layout, spacing, typography } from '@/theme/tokens';

/** Expands each tab's touch area vertically without inflating the strip. */
const TAB_HIT_SLOP = { top: spacing.xs, bottom: spacing.xs, left: 0, right: 0 };

/** Thickness of the active tab's rule. Reads clearly over the table's hairline. */
const ACTIVE_RULE = 2;

export type MarketCategoryOption = {
  readonly id: string;
  readonly label: string;
};

/**
 * Horizontal category filter for the markets table. One scrollable strip keeps
 * every category a single tap away, so switching from crypto to commodities
 * never routes through an opened menu.
 *
 * Selection is carried by an accent rule under the active label rather than by a
 * filled pill: the strip sits directly on the table's top hairline, so the rule
 * lands on that line and reads as the active column of data below it. Inactive
 * labels stay muted, which leaves the accent as the only saturated mark in the
 * header and keeps the eye on the numbers.
 */
export function MarketCategoryTabs({
  options,
  selectedId,
  onSelect,
  compact = false,
}: {
  readonly options: readonly MarketCategoryOption[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly compact?: boolean;
}) {
  return (
    <View accessibilityRole="tablist">
      <ScrollView
        contentContainerStyle={[styles.strip, compact && styles.stripCompact]}
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
  strip: {
    alignItems: 'flex-end',
    gap: spacing.md,
    // The gutter lives inside the scroll content so the strip itself spans the
    // screen: the first tab lines up with the title and the rows, and tabs
    // scrolling past either end travel to the edge rather than to a margin.
    paddingLeft: layout.screenPadding,
    paddingRight: layout.screenPadding,
  },
  stripCompact: {
    paddingLeft: layout.screenPaddingCompact,
    paddingRight: layout.screenPaddingCompact,
  },
  tab: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    // Reserved on every tab so the rule appears without moving the label.
    borderBottomWidth: ACTIVE_RULE,
    borderBottomColor: 'transparent',
  },
  tabSelected: { borderBottomColor: colors.accent },
  label: { ...typography.label, color: colors.textMuted },
  // The active label takes the accent too, a shade lighter than its rule, which
  // is how the ticket marks the live tab. Selection therefore reads from both the
  // rule and the label, never from colour alone.
  labelSelected: { ...typography.label, color: colors.accentSoft },
  pressed: { opacity: 0.72 },
});
