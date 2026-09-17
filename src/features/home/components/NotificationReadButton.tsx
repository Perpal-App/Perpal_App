import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/ui/PressableScale';
import { colors, layout, motion, radii, spacing } from '@/theme/tokens';

/**
 * Diameter. `minTouchTarget` less one step, which keeps the disc close in size to the row's kind
 * mark without overtaking it: a filled circle already carries more weight than a glyph of the same
 * width, and the row's identity should not be the second thing the eye finds. The hit slop below
 * restores the real target to the full 48.
 */
const TARGET = layout.minTouchTarget - spacing.md;

/**
 * Published so a row can put this control on the same centreline as its own mark without hard-coding
 * the diameter, which would silently go stale the next time this file changes.
 */
export const NOTIFICATION_TICK_SIZE = TARGET;

/** Restores the full touch target around the smaller disc, split evenly on every side. */
const HIT_SLOP = (layout.minTouchTarget - TARGET) / 2;

/**
 * The tick's 24-unit box inside the disc.
 *
 * The path below inks 16 of those 24 units across, so the visible mark is two thirds of this. At
 * the previous pairing the tick inked 11.6 units in a 15pt box — under 8pt of glyph on a 32pt disc,
 * which is what made it read as a dot with a scratch in it rather than as a check.
 */
const GLYPH = Math.round(TARGET * 0.56);
const STROKE = 2.2;

/** How far an acknowledged disc recedes. Muted enough to stop competing, solid enough to read. */
const READ_OPACITY = 0.55;

/**
 * The tick, redrawn to the same ink grid as the row's kind glyphs.
 *
 * Spans 4 to 20 across and 6.5 to 17.5 down, which centres the ink on the box's true centre on both
 * axes — a check plotted by its endpoints instead lands low and left, because all of its mass is in
 * the long trailing arm. Short leading arm, long trailing one, round caps and joins, and a lighter
 * weight than the disc could carry: this is a confirmation, and a heavy tick reads as a warning.
 */
const CHECK = 'M4 12.25 9.5 17.5 20 6.5';

/**
 * Mark-as-read control, and the row's read indicator — one object, not two.
 *
 * It used to unmount the moment the row was acknowledged, which is why the tap had nothing to show
 * for itself: the animation and the control it belonged to disappeared on the same frame. Staying
 * mounted also makes read state legible without colour, since the settled fill is visible on the
 * row rather than being expressed by an absence.
 *
 * The press is instant — the store is updated on touch, with no timed gate in front of it — and the
 * feather touch trails it: the disc dips and springs back, a halo leaves the rim, and the outline
 * fills in behind both. A bulk "mark all read" moves the same control to the same settled state
 * without a halo, because a ripple per row would read as twenty separate taps nobody made.
 */
export function NotificationReadButton({
  label,
  onMarkRead,
  read,
}: {
  readonly label: string;
  readonly onMarkRead: () => void;
  readonly read: boolean;
}) {
  const reduceMotion = useReducedMotion();
  /** 0 unread, 1 acknowledged. Drives the fill and the two tick layers. */
  const commit = useSharedValue(read ? 1 : 0);
  /** One outbound ring per direct press. Never driven by `read` alone. */
  const halo = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      commit.set(read ? 1 : 0);
      return;
    }

    commit.set(
      withTiming(read ? 1 : 0, {
        duration: motion.featherTouch.commitMs,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [commit, read, reduceMotion]);

  const handlePress = () => {
    if (!reduceMotion) {
      halo.set(0);
      halo.set(
        withTiming(1, {
          duration: motion.featherTouch.haloMs,
          easing: Easing.out(Easing.cubic),
        }),
      );
    }

    onMarkRead();
  };

  const haloStyle = useAnimatedStyle(() => ({
    opacity: (1 - halo.value) * motion.featherTouch.haloOpacity,
    transform: [{ scale: 1 + (motion.featherTouch.haloScale - 1) * halo.value }],
  }));
  // Acknowledged steps back, the same way the title beside it does. A filled accent disc left at
  // full strength would make every dealt-with row the brightest thing on it, which is backwards:
  // the rows still waiting are the ones worth looking at. Fading the disc rather than choosing a
  // duller fill keeps one colour in the control and lets the same value carry the whole transition.
  const discStyle = useAnimatedStyle(() => ({
    opacity: 1 - commit.value * (1 - READ_OPACITY),
  }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: commit.value }));
  const outlineTickStyle = useAnimatedStyle(() => ({ opacity: 1 - commit.value }));
  const filledTickStyle = useAnimatedStyle(() => ({ opacity: commit.value }));

  return (
    <PressableScale
      accessibilityHint={read ? undefined : 'Marks this event as read'}
      accessibilityLabel={read ? `${label}, read` : `Mark ${label} as read`}
      accessibilityRole="button"
      accessibilityState={{ disabled: read, selected: read }}
      disabled={read}
      hitSlop={HIT_SLOP}
      onPress={handlePress}
      pressedScale={motion.featherTouch.dipScale}
      pressSpring={motion.featherTouch.spring}
      style={styles.target}
    >
      {/* Outside the disc's own bounds, so the ring can travel past the rim without the disc
          having to stop clipping its fill. Non-interactive and hidden from assistive tech: it is
          the tap's echo, and it carries nothing the label does not already say. */}
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.halo, haloStyle]}
      />

      <Animated.View style={[styles.disc, discStyle]}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.fill, fillStyle]}
        />

        {/* Two stacked ticks cross-fading, rather than one tick whose stroke colour animates.
            An SVG `stroke` is a native prop on the path, so driving it would put a colour
            interpolation on the JS thread every frame; two opacities are composited. */}
        <Animated.View style={[styles.glyph, outlineTickStyle]}>
          <Tick color={colors.accentSoft} />
        </Animated.View>
        <Animated.View style={[styles.glyph, filledTickStyle]}>
          <Tick color={colors.onAccent} />
        </Animated.View>
      </Animated.View>
    </PressableScale>
  );
}

function Tick({ color }: { readonly color: string }) {
  return (
    <Svg height={GLYPH} viewBox="0 0 24 24" width={GLYPH}>
      <Path
        d={CHECK}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={STROKE}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  target: {
    width: TARGET,
    height: TARGET,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Laid out as a centred overlay rather than with inset offsets, so the ring stays concentric at
  // any scale it is given.
  halo: {
    position: 'absolute',
    width: TARGET,
    height: TARGET,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentSoft,
  },
  disc: {
    width: TARGET,
    height: TARGET,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    backgroundColor: colors.glassTint,
  },
  fill: { backgroundColor: colors.accent },
  glyph: { position: 'absolute' },
});
