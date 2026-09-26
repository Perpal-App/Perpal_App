import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { PresenceView } from '@/components/motion/PresenceView';
import { PressableScale } from '@/components/ui/PressableScale';
import { orderPlacedCopy } from '@/features/trade/components/PacificaOrderTicketFormatting';
import type { PacificaOrderPlaced } from '@/features/trade/hooks/usePacificaOrderFlow';
import { colors, motion, radii, spacing, typography } from '@/theme/tokens';

/**
 * How long the confirmation stays before it leaves on its own.
 *
 * Longer than a toast's two seconds, and it has to be: a toast is one line of prose that is read in a
 * glance, where this carries a size and a cash figure the reader may well want to check against what
 * they typed. Short enough that it never becomes an obstacle between them and the next order — and it
 * never is one anyway, because `Done` is always there and the timer is not the only way out.
 */
const DISMISS_AFTER_MS = 4_200;

/** Composited box for the mark. A transform, so the ring's overshoot costs no layout pass. */
const MARK_BOX = 76;
const RING_FROM_SCALE = 0.62;
const TICK_FROM_SCALE = 0.7;
/** The tick follows the ring rather than arriving with it, so the two read as one gesture landing. */
const TICK_DELAY_MS = 110;

/** The card grows into place out of the button that was pressed, rather than sliding over it. */
const ENTER_SCALE = 0.94;
const ENTER_TRAVEL = 10;

/**
 * The confirmation a placed order gets, over the ticket that placed it.
 *
 * Before this the ticket said nothing at all. Signing dropped the prepared-order panel and put the
 * `Review buy` button back, which is the same thing the screen shows when a plan is discarded — so the
 * one unambiguous signal that an order had reached the venue was a two-second bar at the top of the
 * screen, above a sheet that was covering most of it. A trade is the most consequential thing this app
 * does and it was the most weakly acknowledged.
 *
 * It covers the form instead of pushing it down. The figures underneath are still true and the reader
 * is about to be looking at them again, so moving them is churn; and a panel inserted into the middle of
 * that column would reflow every row below it while the reader is trying to read one. Absolute, over the
 * top, on the sheet's own surface colour so it reads as the sheet turning over rather than as a second
 * card stacked on the first.
 *
 * Two ways out, which is what was asked for: the timer, and `Done`. Both run the same exit, and neither
 * clears the receipt itself — `PresenceView.onExited` does that once the card has actually gone, so the
 * text cannot blank out halfway through its own dismissal.
 */
export function PacificaOrderPlacedCard({
  baseAsset,
  onDismissed,
  placed,
}: {
  readonly baseAsset: string;
  /** Clears the receipt. Fired after the exit finishes, including under reduce motion. */
  readonly onDismissed: () => void;
  readonly placed: PacificaOrderPlaced | null;
}) {
  const [open, setOpen] = useState(false);

  // Keyed on the receipt's identity, so a second order restarts the countdown rather than inheriting
  // what was left of the first one's — the same reason `AppToastHost` keys its timer by toast id.
  useEffect(() => {
    if (placed === null) return undefined;

    setOpen(true);
    const timer = setTimeout(() => setOpen(false), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [placed]);

  if (placed === null) return null;

  const copy = orderPlacedCopy(placed.plan, baseAsset, placed.orderStatus);

  return (
    <PresenceView
      accessibilityViewIsModal
      fromScale={ENTER_SCALE}
      offsetY={ENTER_TRAVEL}
      onExited={onDismissed}
      style={styles.card}
      visible={open}
    >
      {/* One live region for the pair of lines, so a screen reader announces the outcome and the figure
          as one statement instead of interrupting itself between them. */}
      <View accessibilityLiveRegion="polite" style={styles.body}>
        <PlacedMark />
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={styles.headline}>
          {copy.headline}
        </Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.detail}>
          {copy.detail}
        </Text>
      </View>

      {/* `pressBeforeAction`: the compression finishes before the card starts leaving, so the tap is
          visibly acknowledged rather than swallowed by the exit it triggers. */}
      <PressableScale
        accessibilityHint="Returns to the order ticket"
        accessibilityLabel="Done"
        // Explicit: `PressableScale` forwards to a bare `Pressable`, which carries no role of its own.
        accessibilityRole="button"
        onPress={() => setOpen(false)}
        pressBeforeAction
        style={styles.close}
      >
        <Text style={styles.closeLabel}>Done</Text>
      </PressableScale>
    </PresenceView>
  );
}

/**
 * A ring, then the tick inside it.
 *
 * The ring springs in on `motion.spring`, which is underdamped and so carries one soft overshoot — the
 * app's existing shape for a confirmation, the same overshoot the bookmark uses when something is saved.
 * The tick is the toast's own success path scaled about the centre of the box so it sits inside the ring
 * instead of spanning the full 24-unit grid; keeping the same geometry means a success here and a success
 * in the toast bar are recognisably the same mark.
 *
 * Scale and opacity only, both on the UI thread. Under reduce motion both land on their final values on
 * the first frame, so the state is conveyed without any movement at all.
 */
function PlacedMark() {
  const reduceMotion = useReducedMotion();
  const ring = useSharedValue(reduceMotion ? 1 : 0);
  const tick = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      ring.set(1);
      tick.set(1);
      return;
    }

    ring.set(withSpring(1, motion.spring));
    tick.set(withDelay(
      TICK_DELAY_MS,
      withTiming(1, {
        duration: motion.bookmarkToggle.fillInMs,
        easing: Easing.out(Easing.cubic),
      }),
    ));
  }, [reduceMotion, ring, tick]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value,
    transform: [{ scale: RING_FROM_SCALE + (1 - RING_FROM_SCALE) * ring.value }],
  }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: tick.value,
    transform: [{ scale: TICK_FROM_SCALE + (1 - TICK_FROM_SCALE) * tick.value }],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.mark}
    >
      <Animated.View style={[styles.markLayer, ringStyle]}>
        <Svg height={MARK_BOX} viewBox="0 0 24 24" width={MARK_BOX}>
          <Circle
            cx={12}
            cy={12}
            fill="none"
            r={10.6}
            stroke={colors.positive}
            strokeWidth={1.5}
          />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.markLayer, tickStyle]}>
        <Svg height={MARK_BOX} viewBox="0 0 24 24" width={MARK_BOX}>
          <Path
            d="M7.05 12.15 10.45 15.4 16.95 8.6"
            fill="none"
            stroke={colors.positive}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.9}
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Over the form, on the sheet's own surface. No rim and no radius at the edges it shares with the
  // sheet: it is the same piece of material, not a card floating on one.
  card: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingVertical: spacing.xl,
    backgroundColor: colors.surface,
  },
  body: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm },
  mark: { width: MARK_BOX, height: MARK_BOX, alignItems: 'center', justifyContent: 'center' },
  // Stacked rather than one SVG with two children, so the ring and the tick can carry their own
  // transforms. Absolute keeps both on the box's centre while they scale.
  markLayer: { position: 'absolute' },
  headline: { ...typography.heading, color: colors.textPrimary, textAlign: 'center' },
  detail: { ...typography.bodyCompact, color: colors.textSecondary, textAlign: 'center' },
  // Quiet by construction. Nothing here needs deciding — the order is already at the venue — so this is
  // an acknowledgement, not an action, and it does not take the accent a live control would.
  close: {
    minHeight: 44,
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
  },
  closeLabel: { ...typography.label, color: colors.textPrimary },
});
