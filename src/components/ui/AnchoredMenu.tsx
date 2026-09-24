import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  /** Muted text on the right, before the tick: a balance, a count, whatever qualifies the option. */
  readonly detail?: string;
};

/**
 * Default width, for a menu whose control is narrower than its longest option.
 *
 * 196 rather than the 224 this was. Measured against the bundled Poppins, the longest option any
 * caller on the default carries is "Wallet transfers" at 110pt, which with the row's padding, gap and
 * tick needs 170pt — the old default was 54pt of empty card, and a dropdown that is visibly wider than
 * anything in it reads as detached from the control it belongs to. 196 keeps 26pt of slack, so the
 * label only ellipsises past about a 1.2x text setting, and it has `flexShrink` for that case.
 */
export const MENU_WIDTH = 196;

/** How far from the control the menu sits. Enough to read as detached, not as floating. */
const ANCHOR_GAP = 6;

/**
 * Where the card starts, as a fraction of its final size, and why the two axes differ.
 *
 * Scaled from the corner nearest the control, so a card that starts shorter than it is narrow appears
 * to unfold out of that corner rather than to zoom toward the reader — the apparent corner radius
 * grows with it for free, because scaling a rounded rectangle scales its rounding, which is the whole
 * of the shape morph without animating `borderRadius` and without touching layout.
 *
 * Both are well above zero. A card that starts at nothing is a zoom, and a zoom has no corner to grow
 * from.
 */
const FROM_SCALE_X = 0.86;
const FROM_SCALE_Y = 0.66;

/**
 * One spring, both directions.
 *
 * Damping ratio works out at 0.95 — `damping / (2 * sqrt(stiffness * mass))` — so the card arrives
 * without overshoot, and settles in about 150ms. The previous config claimed to be critically damped
 * and was not: at damping 22, stiffness 320, mass 0.6 the ratio was 0.79, which is enough bounce to
 * read as the card passing its own edge and coming back.
 *
 * The same config runs the dismissal, so opening and closing are the same movement in reverse rather
 * than a spring in and a fade out.
 */
const MENU_SPRING = { damping: 29, mass: 0.55, stiffness: 420 } as const;

/**
 * A menu that unfolds out of the control that opened it.
 *
 * Scaling from the corner nearest the control is what supplies the connection: the card reads as the
 * button unfolding rather than as a new surface arriving. The origin follows the placement, so a menu
 * above its control grows upward from its bottom edge.
 *
 * The card and its contents are animated separately on purpose. The surface reaches full opacity in
 * the first third of the movement while the options only begin to appear after it — so opening shows a
 * shape growing and then filling, and closing empties before it collapses. Fading the card and its
 * text together is what made the old transition read as a cross-dissolve: half-transparent squashed
 * labels were visible for the whole of it.
 *
 * It lives in a `Modal` because it has to draw over the scroll view it sits in and take touches
 * outside itself. That means window coordinates, which is why the caller measures rather than the
 * menu positioning itself relative to a parent.
 *
 * Which *side* the menu takes is still the caller's call — only the caller knows whether its control
 * sits low in a bottom sheet. Where it sits on that side is not: a menu hanging below a control that
 * is itself near the bottom of a scroll view slides up by exactly as much as it would have overflowed,
 * so every option stays on screen and none of them are cut off or hidden behind a scroll.
 *
 * That adaptation is a shrinkable strut above the card rather than a comparison, which is what lets it
 * happen without measuring the viewport, without a layout pass to read a height back, and without the
 * frame of wrong placement that a measure-then-reposition would show on first open. See `styles.lead`.
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
  // Read here rather than taken from a screen, for the same reason the toast host and the tab bar read
  // them: this draws inside a `statusBarTranslucent` Modal, outside `AppScreen` entirely, so there is
  // no safe area above it to inherit. They are used only to keep the card off the system bars — no
  // height is derived from them.
  const insets = useSafeAreaInsets();
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

  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.3, 1], [0, 1, 1], Extrapolation.CLAMP),
    transform: [
      { scaleX: FROM_SCALE_X + (1 - FROM_SCALE_X) * progress.value },
      { scaleY: FROM_SCALE_Y + (1 - FROM_SCALE_Y) * progress.value },
    ],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.35, 0.9], [0, 1], Extrapolation.CLAMP),
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

      {/* The box the card is allowed to occupy. Below a control it spans the window and the lead strut
          places the card inside it; above one it is a box as tall as the control's own offset with the
          card pinned to its lower edge. Neither branch knows how tall the screen is — both are bounded
          by their own absolute edges, which is the layout system answering the question rather than
          this component asking the viewport. */}
      <View
        pointerEvents="box-none"
        style={[
          styles.layer,
          anchor.above
            ? {
              height: anchor.offset,
              justifyContent: 'flex-end',
              paddingTop: insets.top + spacing.sm,
            }
            : { bottom: 0, paddingBottom: insets.bottom + spacing.sm },
        ]}
      >
        {/* The strut that holds the card under its control, and gives way when the card would not fit.
            It wants to be exactly as tall as the gap between the window's top and the control's lower
            edge, which puts the card directly below the button. When the two together are taller than
            the layer, the deficit has to come out of one of them, and this is the one that yields —
            so the card slides up by precisely the overflow and keeps every option.
            Adaptive, with no measurement and no state: nothing here compares a card height to a
            screen height, Yoga just resolves an over-constrained column. */}
        {anchor.above ? null : (
          <View pointerEvents="none" style={[styles.lead, { height: anchor.offset }]} />
        )}

        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.card,
            anchor.above ? styles.cardAbove : styles.cardBelow,
            { marginLeft: anchor.left, width: anchor.width },
            cardStyle,
          ]}
        >
          <Animated.View style={[styles.content, contentStyle]}>
            {title === undefined ? null : (
              <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            )}
            {/* Sizes to its options and scrolls only if the card was still capped after repositioning.
                With `flexShrink` and no `flexGrow` a menu of four is the height of four; it never
                claims the room left over below its control. */}
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              style={styles.scroller}
            >
              {options.map((option) => {
                const checked = option.id === selected;

                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked }}
                    key={option.id}
                    onPress={() => onSelect(option.id)}
                    style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.label, checked && styles.labelChecked]}
                    >
                      {option.label}
                    </Text>
                    {option.detail === undefined ? null : (
                      <Text numberOfLines={1} style={styles.detail}>{option.detail}</Text>
                    )}
                    {checked ? <TickGlyph /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
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
 * wide card under a narrow button is what makes a dropdown look detached from the thing it belongs to.
 *
 * It can never overflow to the right: the card's right edge is the control's right edge, and that is
 * on screen by definition. The left edge is clamped for the case where the card is wider.
 *
 * `offset` is where the card would *prefer* to sit, not where it will end up. The menu treats it as a
 * preference and lifts the card when there is not room below, so this can be called for a control at
 * any scroll position without the caller checking anything.
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
 * have little room to open into. `offset` is the control's own top less the gap, and the card is
 * pinned to the bottom of a box that tall — so the card's bottom edge lands just above the control
 * without anything measuring the card or the viewport.
 *
 * Unlike `anchorBelow` this placement is a hard bound rather than a preference, and that is the point
 * of choosing it: a caller asks for `above` precisely so the card does not cover its own control, so
 * the card shrinks and scrolls here rather than spilling downward. Reach for it where the options are
 * few; where they are many, `anchorBelow` will find the room on its own.
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
  // Anchored to the window and full width, so the card's own margin places it horizontally while the
  // layer's own edges decide how much room it has vertically.
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    alignItems: 'flex-start',
  },
  // Shrinks a thousand times more readily than the card does, which is what makes the two behave as an
  // order of preference rather than a proportional split. Flexbox distributes a deficit by
  // `flexShrink × flexBasis`, so at these weights the strut has given up essentially all of its height
  // before the card loses its first point — the card moves, then and only then does it shrink.
  lead: { flexShrink: 1000 },
  // `flexShrink: 1` is the last resort, not the mechanism. The strut above absorbs the overflow first,
  // so in practice a menu repositions rather than shrinking: six options come to 272pt against roughly
  // 600pt of usable height on the smallest device the app supports, so there is always somewhere to
  // put it. This is here for a caller that one day passes twenty options, and for it the scroller
  // inside takes over.
  //
  // `overflow: hidden` does double duty — it clips the pressed row highlights to the rounded corners,
  // and it guarantees a card at its cap can never paint outside itself even if its contents disagree
  // about how tall they are.
  card: {
    flexShrink: 1,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    // `lg`, a step up from the `md` this was. A menu is a floating object rather than chrome framing
    // data, and at this width the larger radius is what makes it read as one — with
    // `borderCurve: 'continuous'` the corner is a squircle rather than a quarter circle.
    borderRadius: radii.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceElevated,
  },
  // The corner nearest the control, so the card unfolds out of the button instead of swelling from its
  // own middle. This is what the anisotropic scale is anchored to, and without it the asymmetry would
  // read as a stretch rather than as an unfold.
  cardBelow: { transformOrigin: 'top right' },
  cardAbove: { transformOrigin: 'bottom right' },
  // Carries the card's inner padding as well as the content fade, so the scroller between the title
  // and the card's lower edge has somewhere to sit without the padding scrolling with the options.
  content: { flexShrink: 1, paddingVertical: spacing.xxs },
  // No `flexGrow`: it must not claim the space left over when the options already fit, or every menu
  // would be as tall as the room below its control.
  scroller: { flexGrow: 0, flexShrink: 1 },
  // `xxs` vertical, against the `xs` it was. A caps label at 11pt does not need 8pt above and below it
  // to separate from the row under it; its own tracking and colour already do that.
  title: {
    ...typography.eyebrow,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    color: colors.textMuted,
  },
  // 40 rather than 44, and no rule between rows.
  //
  // The separators were the bulk. A hairline under every option turns a menu into a table, and a table
  // of six reads as something to work through rather than a choice to make — which is most of why this
  // card felt oversized when the tallest instance of it is only six rows. Apple's own menus rule
  // between groups, never between the items of one, and every option here belongs to the same group.
  //
  // 40pt is under the 44 usually quoted for a primary target and deliberately so: these are radio
  // options in a list that reopens with one tap, where a mis-tap costs a correction rather than a
  // transaction. Nothing on a signing path uses this height.
  option: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  label: { ...typography.bodyCompact, flexShrink: 1, color: colors.textPrimary },
  labelChecked: { color: colors.accentSoft },
  detail: {
    ...typography.caption,
    flexShrink: 0,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  pressed: { backgroundColor: colors.surface },
});
