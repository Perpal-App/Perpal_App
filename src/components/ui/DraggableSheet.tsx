import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppToastHost } from '@/components/feedback/AppToastHost';
import { PressableScale } from '@/components/ui/PressableScale';
import { restOffset, sheetLeave } from '@/components/ui/sheetMotion';
import { SheetScrollContext, type SheetScroll } from '@/components/ui/sheetScroll';
import { useSheetPosition } from '@/components/ui/useSheetPosition';
import { colors, interfaceType, layout, motion, radii, spacing } from '@/theme/tokens';

export { useSheetScroll } from '@/components/ui/sheetScroll';

/**
 * Share of the host the sheet covers at rest, before it is dragged up.
 *
 * Half, and a flat share rather than anything derived from the content — see `restOffset` for why a
 * content-derived resting height is what made this sheet get stuck. The drag reveals the rest.
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
 * flick counts for more than the distance it covered. Opening and closing are a plain slide each; see
 * `useSheetPosition`, which owns every movement but the finger's.
 *
 * Every position is a share of one measurement — the host's height. That is deliberate and was learned
 * the hard way: a resting height that also depended on the content's height could not be computed until
 * the content had settled, and content that loads in stages does not settle in time. The sheet opened
 * wide and stayed there. One measurement, taken once, from a box whose size does not depend on what is
 * inside it.
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
  fillBody = false,
  onClose,
  restRatio = DEFAULT_REST_RATIO,
  title,
  visible,
}: {
  readonly children: ReactNode;
  /** Spoken label for the close control and the backdrop, e.g. `Close order ticket`. */
  readonly closeLabel: string;
  /**
   * Stretches the body to the sheet's full height, so content can pin its last controls to the bottom
   * with flex — a keypad and its action, sitting at the thumb whatever the phone's height.
   *
   * Only meaningful with `restRatio: 1`, where the sheet's box and its visible area are the same
   * rectangle. At a smaller ratio the bottom of the box is below the screen's edge, and so would be
   * whatever this pinned there.
   */
  readonly fillBody?: boolean;
  readonly onClose: () => void;
  /** Share of the available height the sheet covers before it is dragged up. */
  readonly restRatio?: number;
  /** Shown in the header beside the close control. Omit for a sheet whose content titles itself. */
  readonly title?: string;
  readonly visible: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const position = useSheetPosition({ reduceMotion, restRatio, visible });
  const { afterLeave, arrived, beginLeave, dragStart, expanded, gone, host, offset } = position;
  const scrollRef = useRef<ScrollView>(null);
  // Jumps rather than glides under reduce motion, which is the same rule every other movement here
  // follows: the position still changes, the travel between positions does not play.
  const scroll = useMemo<SheetScroll>(() => ({
    scrollToTop: () => scrollRef.current?.scrollTo({ animated: !reduceMotion, y: 0 }),
  }), [reduceMotion]);

  const requestClose = useCallback(() => onClose(), [onClose]);

  const drag = useMemo(() => Gesture.Pan()
    // A tap has to survive crossing this area, because the close button sits inside it. Nothing claims
    // the touch until the finger has committed to a vertical direction.
    .activeOffsetY([-8, 8])
    .onStart(() => {
      dragStart.set(offset.value);
      runOnJS(arrived)();
    })
    .onUpdate((event) => {
      // Clamped at both ends: the sheet cannot be dragged above the host or torn past the bottom.
      offset.set(Math.min(Math.max(dragStart.value + event.translationY, 0), host.value));
    })
    .onEnd((event) => {
      const projected = offset.value + event.velocityY * FLICK_PROJECTION;
      const resting = restOffset(host.value, restRatio);

      // Nearest of the three, measured against the projection. Expanded is the implicit default so a
      // release with no clear intent opens rather than closes.
      let target = 0;
      let nearest = Math.abs(projected);
      const toRest = Math.abs(projected - resting);
      if (toRest < nearest) {
        target = resting;
        nearest = toRest;
      }
      if (Math.abs(projected - host.value) < nearest) target = host.value;

      if (target === host.value) {
        // Leaves from here, on this frame, instead of stopping where the finger let go while the close
        // goes round through the parent. The exit effect finds it already on its way and leaves it be.
        runOnJS(beginLeave)();
        const travel = gone.value;
        offset.set(withTiming(travel, sheetLeave(travel - offset.value, travel), (done) => {
          'worklet';
          if (done === true) runOnJS(afterLeave)();
        }));
        runOnJS(requestClose)();
        return;
      }

      // Recorded before the spring, so a host resize arriving mid-flight re-derives the position the
      // sheet is heading to rather than the one it is leaving.
      expanded.set(target === 0);
      offset.set(withSpring(target, motion.sheet));
    }), [afterLeave, arrived, beginLeave, dragStart, expanded, gone, host, offset, requestClose, restRatio]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  // Tied to the sheet's position rather than a timeline of its own, so the two can never disagree:
  // dragging the sheet halfway toward gone lightens the backdrop by half. Full strength anywhere at or
  // above rest, including expanded, and fading across exactly the dismissal travel.
  const scrimStyle = useAnimatedStyle(() => {
    const resting = restOffset(host.value, restRatio);
    const span = host.value - resting;

    return {
      opacity: span <= 0
        ? 0
        : SCRIM_OPACITY * (1 - Math.min(Math.max((offset.value - resting) / span, 0), 1)),
    };
  });

  return (
    <Modal
      animationType="none"
      onRequestClose={requestClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={position.mounted}
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
        <SafeAreaView
          edges={['top', 'bottom']}
          onLayout={position.onSafeAreaLayout}
          pointerEvents="box-none"
          style={styles.safeArea}
        >
          {/* The keyboard pads the dock, which is the parent of the transformed view rather than the
              view itself — padding applied to a translated view fights the drag. */}
          <KeyboardAvoidingView
            behavior="padding"
            onLayout={position.onDockLayout}
            pointerEvents="box-none"
            style={styles.dock}
          >
            <Animated.View onLayout={position.onHostLayout} style={[styles.host, sheetStyle]}>
              <View accessibilityViewIsModal style={styles.sheet}>
                <GestureDetector gesture={drag}>
                  <View style={styles.header}>
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
                  contentContainerStyle={[styles.content, fillBody && styles.contentFill]}
                  contentInsetAdjustmentBehavior="never"
                  keyboardShouldPersistTaps="handled"
                  ref={scrollRef}
                  showsVerticalScrollIndicator={false}
                  style={[styles.scroll, fillBody && styles.scrollFill]}
                >
                  <SheetScrollContext.Provider value={scroll}>{children}</SheetScrollContext.Provider>
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
  // Grows as well as shrinks, so the scroll view is the whole of the sheet under the header rather than
  // only as tall as what it holds.
  scrollFill: { flexGrow: 1 },
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
  title: { ...interfaceType.headline, flexShrink: 1, minWidth: 0, color: colors.textPrimary },
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
  // At least the viewport's height, so content shorter than the screen can push its footer to the
  // bottom and content taller than it still scrolls. A tighter base, because what sits there is an
  // action meant for the thumb, and the safe area below it already clears the home indicator.
  contentFill: { flexGrow: 1, paddingBottom: spacing.md },
});
