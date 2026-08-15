import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { colors, radii, spacing, typography } from '@/theme/tokens';

/**
 * Where the menu sits, resolved by the caller from its own control.
 *
 * Everything is in window coordinates, which is the space `measureInWindow` reports and the space a
 * `Modal` draws in. No field is derived from the viewport's size: `offset` is measured from the
 * window's top edge either way, so a device with different insets moves the control and the menu
 * together instead of leaving one behind.
 */
export type MenuAnchor = {
  /** The menu's own left edge. */
  readonly left: number;
  /** The menu's own width, so the caller can size it to the control it belongs to. */
  readonly width: number;
  /**
   * Distance from the window's top to the menu's near edge: its top when hanging below a control, and
   * the control's own top when sitting above one.
   */
  readonly offset: number;
  /** True when the menu sits above its control rather than below it. */
  readonly above: boolean;
};

export type MenuOption<Id extends string> = {
  readonly id: Id;
  readonly label: string;
};

/** Default width, for a menu whose control is narrower than its longest option. */
export const MENU_WIDTH = 224;

/** How far from the control the menu sits. Enough to read as detached, not as floating. */
const ANCHOR_GAP = 6;

/** Scale the card grows from. Well above zero: a menu that starts at nothing reads as a zoom. */
const FROM_SCALE = 0.9;
/** How far the card travels into place, in px. Composited, never a layout offset. */
const DROP = 8;

/**
 * One spring, both directions.
 *
 * Stiffer and better damped than the app's press spring, which is the difference between a control
 * responding to a finger and a surface arriving: damping ratio works out just over 1, so the card
 * settles with no overshoot. A menu that bounces past its own edge looks like a bug.
 *
 * The same config runs the dismissal, so opening and closing are the same movement in reverse rather
 * than a spring in and a fade out.
 */
const MENU_SPRING = { damping: 22, stiffness: 320, mass: 0.6 } as const;

/**
 * A menu that grows out of the control that opened it.
 *
 * Scaling from the corner nearest the control is what supplies the connection: the card reads as the
 * button unfolding rather than as a new surface arriving. The origin follows the placement, so a menu
 * above its control grows upward from its bottom edge.
 *
 * It lives in a `Modal` because it has to draw over the scroll view it sits in and take touches
 * outside itself. That means window coordinates, which is why the caller measures rather than the
 * menu positioning itself relative to a parent.
 *
 * Placement is the caller's call rather than something measured here, and deliberately: only the
 * caller knows whether its control sits low in a bottom sheet. Deciding it here would mean reading the
 * viewport's height to compare against, which is the measurement that breaks across devices with
 * different insets — `anchorAbove` instead builds a box as tall as the control's own offset and pins
 * the card to the bottom of it, so nothing has to know how tall the screen is.
 *
 * Generic over the option id so a caller filtering by a union gets that union back in `onSelect`
 * instead of a bare `string` it has to widen a `useState` to accept.
 */
export function AnchoredMenu<Id extends string>({
  anchor,
  onClose,
  onSelect,
  options,
  selected,
  title,
  visible,
}: {
  readonly anchor: MenuAnchor | null;
  readonly onClose: () => void;
  readonly onSelect: (id: Id) => void;
  readonly options: readonly MenuOption<Id>[];
  readonly selected: Id;
  /** All-caps label above the options. Omit for a menu whose purpose its control already states. */
  readonly title?: string;
  readonly visible: boolean;
}) {
  const reduceMotion = useReducedMotion();
  // `mounted` keeps the modal in the tree; `progress` is how far open the card is. A dismissal has to
  // finish travelling before the modal can unmount, so one boolean cannot express both.
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.set(reduceMotion ? 1 : withSpring(1, MENU_SPRING));
      return;
    }

    if (reduceMotion) {
      progress.set(0);
      setMounted(false);
      return;
    }

    progress.set(withSpring(0, MENU_SPRING, (finished) => {
      'worklet';
      if (finished === true) runOnJS(setMounted)(false);
    }));
  }, [progress, reduceMotion, visible]);

  const above = anchor?.above ?? false;

  const cardStyle = useAnimatedStyle(() => ({
    // Clamped, because a spring can undershoot past zero and a negative opacity is a warning on some
    // platforms rather than simply invisible.
    opacity: Math.max(progress.value, 0),
    transform: [
      { scale: FROM_SCALE + (1 - FROM_SCALE) * progress.value },
      { translateY: (1 - progress.value) * (above ? DROP : -DROP) },
    ],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: Math.max(progress.value, 0),
  }));

  if (anchor === null) return null;

  return (
    <Modal
      // The presentation is ours: `animationType` would run a second, unsprung transition underneath
      // this one and the two would fight over the same frames.
      animationType="none"
      onRequestClose={onClose}
      // Aligns the modal's coordinate space with the window coordinates the anchor was measured in.
      // Without it Android offsets the modal by the status bar and the menu hangs too low.
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable
          accessibilityLabel="Close menu"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* Two placements, one with padding above the card and one with a box the card sits at the
          bottom of. Both are built from the control's measured offset alone, so neither needs the
          window's height. */}
      <View
        pointerEvents="box-none"
        style={[
          styles.layer,
          anchor.above
            ? { height: anchor.offset, justifyContent: 'flex-end' }
            : { paddingTop: anchor.offset },
        ]}
      >
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.card,
            anchor.above ? styles.cardAbove : styles.cardBelow,
            { marginLeft: anchor.left, width: anchor.width },
            cardStyle,
          ]}
        >
          {title === undefined ? null : (
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          )}
          {options.map((option, index) => {
            const checked = option.id === selected;

            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                key={option.id}
                onPress={() => onSelect(option.id)}
                style={({ pressed }) => [
                  styles.option,
                  index > 0 && styles.divided,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.label, checked && styles.labelChecked]}
                >
                  {option.label}
                </Text>
                {checked ? <TickGlyph /> : null}
              </Pressable>
            );
          })}
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Hangs the menu under a control, right-aligned to it.
 *
 * `width` defaults to the wider card, for a control too narrow to carry its own options. Pass the
 * control's measured width — clamped to something the options fit in — when the two should match; a
 * 224pt card under a 120pt button is what makes a dropdown look detached from the thing it belongs to.
 *
 * It can never overflow to the right: the card's right edge is the control's right edge, and that is
 * on screen by definition. The left edge is clamped for the case where the card is wider.
 */
export function anchorBelow(
  x: number,
  y: number,
  width: number,
  height: number,
  menuWidth: number = MENU_WIDTH,
): MenuAnchor {
  return {
    above: false,
    left: Math.max(x + width - menuWidth, spacing.sm),
    offset: y + height + ANCHOR_GAP,
    width: menuWidth,
  };
}

/**
 * Sits the menu above a control, right-aligned to it.
 *
 * For a control near the bottom of the screen or of a bottom sheet, where a menu hanging below would
 * run off the edge. `offset` is the control's own top less the gap, and the card is pinned to the
 * bottom of a box that tall — so the card's bottom edge lands just above the control without anything
 * measuring the card or the viewport.
 */
export function anchorAbove(
  x: number,
  y: number,
  width: number,
  menuWidth: number = MENU_WIDTH,
): MenuAnchor {
  return {
    above: true,
    left: Math.max(x + width - menuWidth, spacing.sm),
    offset: Math.max(y - ANCHOR_GAP, 0),
    width: menuWidth,
  };
}

/** Round caps and joins, so a heavy tick does not end in two hard points. */
function TickGlyph() {
  return (
    <Svg height={16} viewBox="0 0 24 24" width={16}>
      <Path
        d="M5 12.6 9.7 17.3 19 8"
        fill="none"
        stroke={colors.accentSoft}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.4}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // Its own layer, so the fade never touches the card's opacity: dimming the card as it grew would
  // make it read as a projection rather than as a surface.
  backdrop: { backgroundColor: 'rgba(5, 5, 9, 0.44)' },
  // Anchored to the top of the window and full width, so the card's own margin places it
  // horizontally and the layer's height or padding places it vertically.
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    alignItems: 'flex-start',
  },
  card: {
    overflow: 'hidden',
    paddingVertical: spacing.xxs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceElevated,
  },
  // The corner nearest the control, so the card unfolds from the button instead of swelling from its
  // own middle.
  cardBelow: { transformOrigin: 'top right' },
  cardAbove: { transformOrigin: 'bottom right' },
  title: {
    ...typography.eyebrow,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    color: colors.textMuted,
  },
  option: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  label: { ...typography.bodyCompact, flexShrink: 1, color: colors.textPrimary },
  labelChecked: { color: colors.accentSoft },
  pressed: { backgroundColor: colors.surface },
});
