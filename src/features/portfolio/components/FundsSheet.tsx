import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/ui/PressableScale';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { PrivateFundingPanel } from '@/features/account/private-funding';
import { PrivateWithdrawPanel } from '@/features/portfolio/components/PrivateWithdrawPanel';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, layout, motion, radii, spacing } from '@/theme/tokens';

export type FundsMode = 'deposit' | 'withdraw';

/**
 * Share of the sheet's own height a release must be heading past for it to close.
 *
 * Under half, because a drag downward is a dismissal gesture and hesitating in the middle of one
 * usually means letting go, not asking for the sheet to spring back up.
 */
const DISMISS_RATIO = 0.34;

/**
 * How far a release is projected past where the finger stopped, in seconds of its own velocity.
 *
 * This is what makes a flick land where it was aimed instead of where it was let go. Without it a fast
 * downward flick from the top of the sheet would spring back, because it never travelled far enough.
 */
const FLICK_PROJECTION = 0.13;

/**
 * Backdrop left visible above the sheet at its tallest.
 *
 * A fixed gap rather than a share of the viewport, and it is what bounds the sheet: the dock reserves
 * this much and the sheet shrinks into whatever is left. A percentage `maxHeight` was here before and
 * did nothing at all — it resolves against its parent, and the animated wrapper the drag needs has no
 * height of its own, so the constraint was silently dropped and the sheet grew past the screen.
 *
 * It sits inside the top safe area, so the gap is measured below the notch rather than under it.
 */
const BACKDROP_GAP = spacing.xxl;

/**
 * The deposit and withdraw panels, in a sheet that can be dragged down to close.
 *
 * Dragging did nothing before, and it took two fixes rather than one. There was no pan gesture at all
 * — the grabber was a decoration — and installing one would still have received no events: a React
 * Native `Modal` mounts into a separate native view hierarchy, outside the `GestureHandlerRootView` at
 * the top of the app, so modal content has to install its own root.
 *
 * The presentation is ours rather than `animationType="slide"`, because the two cannot share the same
 * frames: the platform's slide sets its own transform on the same view the drag is translating, and
 * the sheet would fight the finger.
 *
 * The pan lives on the header, not the whole sheet. A pan over the scrolling body would have to
 * arbitrate with the scroll view for every downward swipe — the usual source of sheets that refuse to
 * scroll or refuse to close — whereas the header can never be ambiguous about which one the finger
 * meant. It covers the full width and both rows, so the grabber is the affordance and not the target.
 */
export function FundsSheet({
  balances,
  mode,
  onClose,
  snapshot,
}: {
  /** Forwarded so the withdraw panel lists the tokens actually held, not every supported one. */
  readonly balances: WalletBalances | null;
  readonly mode: FundsMode | null;
  readonly onClose: () => void;
  readonly snapshot: PacificaPortfolioSnapshot | null;
}) {
  const reduceMotion = useReducedMotion();
  // `mounted` keeps the modal in the tree; `offset` is where the sheet sits. A dismissal has to finish
  // travelling before the modal can unmount, so one boolean cannot express both.
  const [mounted, setMounted] = useState(false);
  const [measured, setMeasured] = useState(0);
  const presented = useRef(false);
  /** The sheet's own measured height. Every position is relative to it, never to the viewport. */
  const height = useSharedValue(0);
  /** Translation from resting: 0 is open, `height` is fully off the bottom. */
  const offset = useSharedValue(0);
  const dragStart = useSharedValue(0);

  const visible = mode !== null;
  // Held invisible for the one frame between mount and measurement. It replaces the guessed height
  // this used to slide in from: the travel is the sheet's own height, so there is nothing to animate
  // from until that is known, and a placeholder distance would start the slide in the wrong place.
  const ready = measured > 0;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    presented.current = false;
  }, [visible]);

  // Presentation waits for the measurement, because the travel is the sheet's own height: sliding in
  // from a fallback would settle at the wrong place and then correct itself once the real number
  // arrived.
  useEffect(() => {
    if (!visible || measured === 0 || presented.current) return;

    presented.current = true;
    offset.set(measured);
    offset.set(reduceMotion ? 0 : withSpring(0, motion.sheet));
  }, [measured, offset, reduceMotion, visible]);

  // Runs the exit whenever the sheet stops being wanted, including after a drag has already carried it
  // most of the way down — the spring picks up from wherever the finger left it, so a release and its
  // dismissal are one continuous movement rather than a snap and then a slide.
  useEffect(() => {
    if (visible || !mounted) return;

    if (reduceMotion) {
      setMounted(false);
      return;
    }

    offset.set(withSpring(height.value, motion.sheet, (finished) => {
      'worklet';
      if (finished === true) runOnJS(setMounted)(false);
    }));
  }, [height, mounted, offset, reduceMotion, visible]);

  const requestClose = useCallback(() => onClose(), [onClose]);

  const drag = useMemo(() => Gesture.Pan()
    // A tap has to survive crossing this area, because the close button sits inside it. Nothing claims
    // the touch until the finger has committed to a vertical direction.
    .activeOffsetY([-8, 8])
    .onStart(() => {
      dragStart.set(offset.value);
    })
    .onUpdate((event) => {
      // Clamped at both ends: the sheet cannot be dragged above its resting position or torn past the
      // bottom of the screen.
      offset.set(Math.min(Math.max(dragStart.value + event.translationY, 0), height.value));
    })
    .onEnd((event) => {
      const projected = offset.value + event.velocityY * FLICK_PROJECTION;

      if (projected > height.value * DISMISS_RATIO) {
        // Hands the decision to the parent and lets the exit effect finish the travel, so the sheet
        // never has two springs describing the same movement.
        runOnJS(requestClose)();
        return;
      }

      offset.set(withSpring(0, motion.sheet));
    }), [dragStart, height, offset, requestClose]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  const onSheetLayout = useCallback((event: LayoutChangeEvent) => {
    const value = event.nativeEvent.layout.height;
    height.set(value);
    setMeasured(value);
  }, [height]);

  return (
    <Modal
      animationType="none"
      onRequestClose={requestClose}
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      {/* Its own gesture root: a `Modal` renders outside the one at the top of the app, so without
          this the pan would never receive an event. */}
      <GestureHandlerRootView style={styles.root}>
        <Pressable
          accessibilityLabel="Close funds panel"
          accessibilityRole="button"
          onPress={requestClose}
          style={styles.scrim}
        />
        {/* A modal renders outside the screen tree, so it is on its own for insets — this is one of
            the few places besides AppScreen and the tab bar that reads them. Both edges, so the
            backdrop gap starts below the notch and the sheet's own base clears the home indicator. */}
        <SafeAreaView edges={['top', 'bottom']} pointerEvents="box-none" style={styles.safeArea}>
          <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.dock}>
            {/* Every box down this chain can shrink, which is what makes the sheet fit any device
                without a single measurement: it is as tall as its content where there is room, and
                compresses into whatever the dock leaves where there is not. The scroll view is last
                to give way, so the overflow becomes scrolling rather than a clipped button. */}
            <Animated.View
              onLayout={onSheetLayout}
              style={[styles.wrapper, !ready && styles.hidden, sheetStyle]}
            >
              <View accessibilityViewIsModal style={styles.sheet}>
                <GestureDetector gesture={drag}>
                  <View style={styles.header}>
                    <View accessibilityElementsHidden style={styles.grabber} />
                    <View style={styles.headerRow}>
                      <PressableScale
                        accessibilityLabel="Close"
                        accessibilityRole="button"
                        hitSlop={12}
                        onPress={requestClose}
                        style={styles.close}
                      >
                        <CloseIcon />
                      </PressableScale>
                    </View>
                  </View>
                </GestureDetector>

                <ScrollView
                  contentContainerStyle={styles.content}
                  contentInsetAdjustmentBehavior="never"
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  style={styles.scroll}
                >
                  {mode === 'deposit' ? <PrivateFundingPanel tradingReady /> : null}
                  {mode === 'withdraw' ? (
                    <PrivateWithdrawPanel balances={balances} snapshot={snapshot} />
                  ) : null}
                </ScrollView>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Drawn rather than pulled from an icon font, like every other glyph in the app. */
function CloseIcon() {
  return (
    <Svg height={18} viewBox="0 0 24 24" width={18}>
      <Path
        d="M6 6 18 18M18 6 6 18"
        fill="none"
        stroke={colors.textPrimary}
        strokeLinecap="round"
        strokeWidth={2}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim, opacity: 0.72 },
  safeArea: { flex: 1 },
  // The gap is padding on the dock rather than a height on the sheet, so the bound is expressed as
  // "leave this much backdrop" instead of "be this tall" — the same result on every device, with
  // nothing to recompute per screen size.
  dock: { flex: 1, justifyContent: 'flex-end', paddingTop: BACKDROP_GAP },
  // Shrinkable and full width. Without `flexShrink` a sheet taller than the dock overflows the bottom
  // of the screen instead of compressing, which is exactly how the action button came to be clipped.
  wrapper: { width: '100%', flexShrink: 1 },
  hidden: { opacity: 0 },
  sheet: {
    flexShrink: 1,
    overflow: 'hidden',
    borderTopLeftRadius: radii.panel,
    borderTopRightRadius: radii.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  // Last to give way, and the only box that may. The header keeps its full size so the grabber and
  // the close control are never squeezed out of reach.
  scroll: { flexShrink: 1 },
  // The pan's target: full width, both rows, so a finger anywhere in the head of the sheet can drag it.
  header: { paddingBottom: spacing.xxs },
  grabber: {
    width: 44,
    height: 4,
    alignSelf: 'center',
    marginTop: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
  },
  headerRow: {
    minHeight: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
  },
  close: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  content: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: spacing.xxl,
  },
});
