import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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

import { AppToastHost } from '@/components/feedback/AppToastHost';
import { PressableScale } from '@/components/ui/PressableScale';
import { colors, layout, motion, radii, spacing, typography } from '@/theme/tokens';

/**
 * Most of the host the sheet may cover at rest, before it is dragged up.
 *
 * A ceiling rather than a height. The sheet rests at whichever is smaller, this share or its content's
 * own height, which is what stops a short card from opening as a tall panel with an empty lower half —
 * the deposit form is about 45% of a phone, and at a flat fraction the rest of the sheet was blank
 * surface. Long content rests here and the drag reveals the remainder.
 */
const DEFAULT_REST_RATIO = 0.5;

/**
 * How far a release is projected past where the finger stopped, in seconds of its own velocity.
 *
 * What makes a flick land where it was aimed instead of where it was let go. Without it a fast flick
 * from near the top springs back, because it never travelled far enough to be nearest anything else.
 *
 * Shared with the app's other two sheets, which arrived at the same number independently.
 */
const FLICK_PROJECTION = 0.13;

/** Backdrop left visible above the sheet at its tallest, measured inside the top safe area. */
const BACKDROP_GAP = spacing.xxl;

/** How dark the backdrop gets with the sheet at rest or above. */
const SCRIM_OPACITY = 0.72;

const GRABBER = { width: 44, height: 4 } as const;
const CLOSE_SIZE = 36;
const CLOSE_GLYPH = 18;

/**
 * Where the sheet opens, as a translation from filling the host.
 *
 * A worklet so the gesture can call it on the UI thread and the effects can call it on the JS one —
 * the alternative was the same arithmetic written twice and drifting.
 *
 * Derived from the host alone. An earlier version took the smaller of this and the content's own
 * height, so a short card would hug itself instead of leaving empty surface below — and that is what
 * made the sheet get stuck. The content here is an order ticket whose height changes twice while it
 * loads: a short balance skeleton first, then the full form. Presentation had to wait for a content
 * measurement, so a run where that measurement arrived as zero left the sheet at its initial offset,
 * which is fully expanded. A resting height that depends on something still settling cannot be
 * depended on.
 *
 * Expanded is always 0 — filling the host, with the body scrolling. Content shorter than the ratio
 * leaves some surface below it at rest; that is the price of a position that is the same every time,
 * and a caller with genuinely short content can pass a smaller `restRatio`.
 */
function restOffset(host: number, ratio: number): number {
  'worklet';
  return Math.max(host - host * ratio, 0);
}

/**
 * A bottom sheet that can be dragged up to expand and down to dismiss.
 *
 * This is the third hand-rolled sheet in the app and the first one that is shared. `FundsSheet` (the
 * deposit and withdraw card) and `NotificationsPanel` each solved half of the problem: the first knows
 * how to survive a keyboard, the second knows how to snap between heights. A fourth private copy for
 * the order ticket would have been the wrong answer, so this merges the two and the order ticket is
 * its first caller. The existing two are unchanged for now and should migrate onto this.
 *
 * Three positions, chosen by where a release was *heading* rather than where it stopped: expanded
 * (filling the host), resting (`restRatio` of it), and gone. Drag up to expand, down to close, and a
 * flick counts for more than the distance it covered.
 *
 * Two pieces of hard-won knowledge are load-bearing here and are the reason this is worth sharing:
 *
 * 1. It mounts its own `GestureHandlerRootView`. A React Native `Modal` renders into a separate native
 *    view hierarchy, outside the root at the top of the app, so without one the pan receives no events
 *    at all — the sheet looks draggable and simply is not.
 * 2. The presentation is ours rather than `animationType="slide"`. The platform's slide sets its own
 *    transform on the very view the drag translates, and the sheet fights the finger.
 *
 * The pan is on the header, never the body. A pan over a scrolling body has to arbitrate with the
 * scroll view on every downward swipe, which is the usual cause of sheets that refuse to scroll or
 * refuse to close. The header cannot be ambiguous about which the finger meant.
 */
export function DraggableSheet({
  children,
  closeLabel,
  onClose,
  restRatio = DEFAULT_REST_RATIO,
  title,
  visible,
}: {
  readonly children: ReactNode;
  /** Spoken label for the close control and the backdrop, e.g. `Close order ticket`. */
  readonly closeLabel: string;
  readonly onClose: () => void;
  /** Share of the available height the sheet covers before it is dragged up. */
  readonly restRatio?: number;
  /** Shown in the header beside the close control. Omit for a sheet whose content titles itself. */
  readonly title?: string;
  readonly visible: boolean;
}) {
  const reduceMotion = useReducedMotion();
  // `mounted` keeps the modal in the tree; `offset` is where the sheet sits. A dismissal has to finish
  // travelling before the modal can unmount, so one boolean cannot express both.
  const [mounted, setMounted] = useState(false);
  const [hostHeight, setHostHeight] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const presented = useRef(false);
  const lastHost = useRef(0);
  /** Usable height inside the safe area and below the backdrop gap. Every position is measured in it. */
  const host = useSharedValue(0);
  /** Header plus content: how tall the sheet would be if nothing constrained it. */
  const natural = useSharedValue(0);
  /** Translation from filling the host: 0 is as tall as it can be, `host` is fully off the bottom. */
  const offset = useSharedValue(0);
  const dragStart = useSharedValue(0);
  // Refs rather than state: the two halves arrive from different callbacks in no fixed order, and only
  // their sum is worth a render.
  const headerHeight = useRef(0);
  const contentHeight = useRef(0);

  const commitNatural = useCallback(() => {
    if (headerHeight.current === 0 || contentHeight.current === 0) return;

    const total = headerHeight.current + contentHeight.current;
    natural.set(total);
    setNaturalHeight(total);
  }, [natural]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    presented.current = false;
  }, [visible]);

  const finish = useCallback(() => {
    setMounted(false);
    setHostHeight(0);
    setNaturalHeight(0);
    lastHost.current = 0;
  }, []);

  // Presentation waits for both measurements, because the resting height is the smaller of the content
  // and the ratio. Springing in against a guess settles the sheet in the wrong place and then corrects
  // itself once the real number lands, which reads as the sheet bouncing twice.
  useEffect(() => {
    if (!visible || hostHeight === 0 || naturalHeight === 0 || presented.current) return;

    presented.current = true;
    offset.set(hostHeight);
    const target = restOffset(hostHeight, naturalHeight, restRatio);
    offset.set(reduceMotion ? target : withSpring(target, motion.sheet));
  }, [hostHeight, naturalHeight, offset, reduceMotion, restRatio, visible]);

  // The dock shrinks when the keyboard opens, so every snap point moves under the sheet. Rather than
  // re-derive a position that is now measured against a different host, expand: a field has focus, and
  // the most room available is what typing into one wants. Skips the first measurement, which the
  // presentation effect above owns.
  useEffect(() => {
    if (hostHeight === 0) return;

    const previous = lastHost.current;
    lastHost.current = hostHeight;
    if (previous === 0 || previous === hostHeight || !presented.current) return;

    const target = fullOffset(hostHeight, naturalHeight);
    offset.set(reduceMotion ? target : withSpring(target, motion.sheet));
  }, [hostHeight, naturalHeight, offset, reduceMotion]);

  // Runs the exit whenever the sheet stops being wanted, including after a drag has already carried it
  // most of the way down — the spring picks up from wherever the finger left it, so a release and its
  // dismissal are one movement rather than a snap and then a slide.
  useEffect(() => {
    if (visible || !mounted) return;

    if (reduceMotion) {
      finish();
      return;
    }

    // `sheetDismiss`, not `sheet`. The arrival spring's tail is what makes closing feel delayed: the
    // sheet looks gone while the spring is still running and the modal only unmounts once it finishes.
    offset.set(withSpring(host.value, motion.sheetDismiss, (done) => {
      'worklet';
      if (done === true) runOnJS(finish)();
    }));
  }, [finish, host, mounted, offset, reduceMotion, visible]);

  const requestClose = useCallback(() => onClose(), [onClose]);

  const drag = useMemo(() => Gesture.Pan()
    // A tap has to survive crossing this area, because the close button sits inside it. Nothing claims
    // the touch until the finger has committed to a vertical direction.
    .activeOffsetY([-8, 8])
    .onStart(() => {
      dragStart.set(offset.value);
    })
    .onUpdate((event) => {
      // Clamped at both ends: the sheet cannot be dragged above the host or torn past the bottom.
      offset.set(Math.min(Math.max(dragStart.value + event.translationY, 0), host.value));
    })
    .onEnd((event) => {
      const projected = offset.value + event.velocityY * FLICK_PROJECTION;
      const expanded = fullOffset(host.value, natural.value);
      const resting = restOffset(host.value, natural.value, restRatio);

      // Nearest of the three, measured against the projection. Expanded is the implicit default so a
      // release with no clear intent opens rather than closes.
      let target = expanded;
      let nearest = Math.abs(projected - expanded);
      const toRest = Math.abs(projected - resting);
      if (toRest < nearest) {
        target = resting;
        nearest = toRest;
      }
      if (Math.abs(projected - host.value) < nearest) target = host.value;

      if (target === host.value) {
        // Hands the decision up and lets the exit effect finish the travel, so there are never two
        // springs describing the same movement.
        runOnJS(requestClose)();
        return;
      }

      offset.set(withSpring(target, motion.sheet));
    }), [dragStart, host, natural, offset, requestClose, restRatio]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  // Tied to the sheet's position rather than a timeline of its own, so the two can never disagree:
  // dragging the sheet halfway toward gone lightens the backdrop by half. Full strength anywhere at or
  // above rest, including expanded, and fading across exactly the dismissal travel.
  const scrimStyle = useAnimatedStyle(() => {
    const resting = restOffset(host.value, natural.value, restRatio);
    const span = host.value - resting;

    return {
      opacity: span <= 0
        ? 0
        : SCRIM_OPACITY * (1 - Math.min(Math.max((offset.value - resting) / span, 0), 1)),
    };
  });

  // Measured on the inner animated view rather than the `SafeAreaView`, whose own height still
  // includes the insets — measuring that yields positions that are all slightly wrong.
  const onHostLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height;
    host.set(measured);
    setHostHeight(measured);
  }, [host]);

  // The header is measured rather than assumed, because it carries a title that can wrap at a large
  // text size, and the resting height is header plus content.
  const onHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    headerHeight.current = event.nativeEvent.layout.height;
    commitNatural();
  }, [commitNatural, headerHeight]);

  return (
    <Modal
      animationType="none"
      onRequestClose={requestClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          <Pressable
            accessibilityLabel={closeLabel}
            accessibilityRole="button"
            onPress={requestClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* A modal renders outside the screen tree, so it is on its own for insets — one of the few
            places besides `AppScreen` and the tab bar that reads them. Both edges, so the backdrop gap
            starts below the notch and the sheet's base clears the home indicator. */}
        <SafeAreaView edges={['top', 'bottom']} pointerEvents="box-none" style={styles.safeArea}>
          {/* The keyboard pads the dock, which is the parent of the transformed view rather than the
              view itself — padding applied to a translated view fights the drag. */}
          <KeyboardAvoidingView behavior="padding" pointerEvents="box-none" style={styles.dock}>
            <Animated.View onLayout={onHostLayout} style={[styles.host, sheetStyle]}>
              <View accessibilityViewIsModal style={styles.sheet}>
                <GestureDetector gesture={drag}>
                  <View onLayout={onHeaderLayout} style={styles.header}>
                    <View accessibilityElementsHidden pointerEvents="none" style={styles.grabber} />
                    <View style={styles.headerRow}>
                      {title === undefined ? null : (
                        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
                          {title}
                        </Text>
                      )}
                      <PressableScale
                        accessibilityLabel={closeLabel}
                        accessibilityRole="button"
                        hitSlop={12}
                        onPress={requestClose}
                        style={styles.close}
                      >
                        <Ionicons color={colors.textPrimary} name="close" size={CLOSE_GLYPH} />
                      </PressableScale>
                    </View>
                  </View>
                </GestureDetector>

                {/* Last to give way, and the only box that may. The header keeps its full size so the
                    grabber and the close control are never squeezed out of reach by the keyboard. */}
                <ScrollView
                  contentContainerStyle={styles.content}
                  contentInsetAdjustmentBehavior="never"
                  keyboardShouldPersistTaps="handled"
                  // The content's own height, which is half of where the sheet comes to rest. Taken from
                  // the scroller rather than an `onLayout` on a wrapper, because this is the measurement
                  // the scroller already makes to decide whether it can scroll at all.
                  onContentSizeChange={(_width, height) => {
                    contentHeight.current = height;
                    commitNatural();
                  }}
                  showsVerticalScrollIndicator={false}
                  style={styles.scroll}
                >
                  {children}
                </ScrollView>
              </View>
            </Animated.View>
          </KeyboardAvoidingView>
        </SafeAreaView>

        {/* Inside the modal root, so a toast raised by the sheet's own content is not painted behind
            it by the host screen's copy. */}
        <AppToastHost />
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // No static opacity: the animated style owns it, and a value here would multiply against that one.
  scrim: { backgroundColor: colors.scrim },
  safeArea: { flex: 1 },
  // The gap is padding on the dock rather than a height on the sheet, so the bound reads as "leave
  // this much backdrop" instead of "be this tall" — the same result on every device with nothing to
  // recompute per screen size.
  dock: { flex: 1, justifyContent: 'flex-end', paddingTop: BACKDROP_GAP },
  // Fills the dock. The sheet's visible height is the translation, not this box, which is what lets one
  // gesture move continuously between expanded, resting and gone.
  host: { width: '100%', flex: 1 },
  sheet: {
    flex: 1,
    overflow: 'hidden',
    borderTopLeftRadius: radii.panel,
    borderTopRightRadius: radii.panel,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  scroll: { flexShrink: 1 },
  // The pan's target: full width and both rows, so a finger anywhere in the head of the sheet drags it
  // and the 4pt bar is the affordance rather than the target.
  header: { paddingBottom: spacing.xxs },
  grabber: {
    ...GRABBER,
    alignSelf: 'center',
    marginTop: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
  },
  headerRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: layout.screenPadding,
  },
  title: { ...typography.label, flexShrink: 1, minWidth: 0, color: colors.textPrimary },
  // `marginLeft: 'auto'` rather than `space-between` on the row, so the control stays on the right
  // whether or not a title is present. With `space-between` a titleless sheet put its close button on
  // the left, which is where nobody looks for one.
  close: {
    width: CLOSE_SIZE,
    height: CLOSE_SIZE,
    flexShrink: 0,
    marginLeft: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
  },
  content: { paddingHorizontal: layout.screenPadding, paddingBottom: spacing.xxl },
});
