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

export type UnderlineTabOption<Id extends string = string> = {
  readonly id: Id;
  readonly label: string;
};

/**
 * Scrollable tab strip where selection is an accent rule under the active label.
 *
 * The strip is meant to sit directly on the hairline of whatever it filters, so
 * the rule lands on that line and ties the two together. Callers pass their own
 * `contentStyle` for the gutter, which lets the strip span the full screen while
 * its first tab still lines up with the content beside it.
 *
 * Generic over the id so a caller filtering by a union — a news category, a sort
 * direction — gets that union back in `onSelect` instead of a bare `string` it has
 * to widen a `useState` to accept or cast on the way in. It defaults to `string`,
 * so a caller with plain ids needs no type argument.
 */
export function UnderlineTabs<Id extends string = string>({
  contentStyle,
  onSelect,
  options,
  selectedId,
}: {
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly onSelect: (id: Id) => void;
  readonly options: readonly UnderlineTabOption<Id>[];
  readonly selectedId: Id;
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
  // One flex `gap` sets every space in the strip, so the rhythm is even by construction — no
  // tab carries padding of its own that could widen the space on one side of it. It also keeps
  // each tab's box the width of its own label, which is what the active rule measures itself
  // against: give the tabs horizontal padding instead and the underline grows wider than the
  // word it belongs to.
  strip: { alignItems: 'flex-end', gap: spacing.lg },
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
