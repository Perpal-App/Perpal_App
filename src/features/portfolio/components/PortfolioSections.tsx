import { useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ActionButton } from '@/components/ui/ActionButton';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { colors, interfaceType, motion, spacing } from '@/theme/tokens';

export type PortfolioSection = 'activity' | 'positions';

/**
 * The lower half of the portfolio: its history, and what is open now — one at a time, under a segmented
 * control. Activity first, as the view the screen opens on; positions second, with their count on the
 * segment so an open position is never out of sight just because its list is.
 *
 * Both lists stay mounted and the one not chosen is taken out of the layout, so switching back finds the
 * activity where it was left — its search, its filter, how far it was read — rather than fetched afresh.
 * The one arriving fades in with a few points of travel from the side the thumb went, which is what makes
 * the control and the content read as one movement.
 */
export function PortfolioSections({
  activity,
  onSectionChange,
  positionCount,
  positions,
  section,
}: {
  readonly activity: ReactNode;
  readonly onSectionChange: (section: PortfolioSection) => void;
  readonly positionCount: number;
  /** What is open, or `null` when nothing is, for the empty state. */
  readonly positions: ReactNode;
  readonly section: PortfolioSection;
}) {
  return (
    <View style={styles.sections}>
      <SegmentedControl
        accessibilityLabel="Portfolio view"
        onSelect={onSectionChange}
        options={[
          { id: 'activity', label: 'Activity' },
          { count: positionCount, id: 'positions', label: 'Positions' },
        ]}
        selected={section}
      />
      <Pane active={section === 'activity'} side={-1}>{activity}</Pane>
      <Pane active={section === 'positions'} side={1}>{positions ?? <NoPositions />}</Pane>
    </View>
  );
}

/**
 * One section's content. Out of the layout while it is not chosen, and arriving, when it is, from the
 * side its segment sits on: `-1` the left, `1` the right. Already in place on the first render, so the
 * screen does not open on an animation.
 */
function Pane({
  active,
  children,
  side,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly side: -1 | 1;
}) {
  const reduceMotion = useReducedMotion();
  const arrival = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    // Reset while hidden, so the first frame it is shown again is already the start of its arrival.
    if (!active) {
      arrival.set(0);
      return;
    }
    arrival.set(reduceMotion ? 1 : withTiming(1, {
      duration: motion.segment.pane.duration,
      easing: Easing.out(Easing.cubic),
    }));
  }, [active, arrival, reduceMotion]);

  const arrivalStyle = useAnimatedStyle(() => ({
    opacity: arrival.value,
    transform: [{ translateX: (1 - arrival.value) * side * motion.segment.pane.travel }],
  }));

  return (
    <Animated.View
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      style={[arrivalStyle, !active && styles.hidden]}
    >
      {children}
    </Animated.View>
  );
}

/** Nothing open: what will land here, and the one way to get something there. */
function NoPositions() {
  const router = useRouter();

  return (
    <View style={styles.empty}>
      <Text accessibilityRole="header" style={styles.emptyTitle}>No open positions</Text>
      <Text style={styles.emptyMessage}>
        Positions you open show here, valued live, and close from their card.
      </Text>
      <ActionButton
        gooey
        label="Explore markets"
        labelStyle={interfaceType.control}
        onPress={() => router.navigate('/(tabs)/trade')}
        style={styles.emptyAction}
        tone="neutral"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sections: { gap: spacing.md },
  hidden: { display: 'none' },
  empty: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  emptyTitle: { ...interfaceType.headline, color: colors.textPrimary },
  emptyMessage: { ...interfaceType.caption, maxWidth: 260, color: colors.textMuted, textAlign: 'center' },
  emptyAction: { minWidth: 180, marginTop: spacing.sm },
});
