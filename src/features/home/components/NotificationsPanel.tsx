import { LinearGradient } from 'expo-linear-gradient';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
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
import { NotificationsSheet } from '@/features/home/components/NotificationsSheet';
import type { MarketNewsArticle } from '@/integrations/market-data/marketBriefing';
import {
  countUnreadInAppNotifications,
  readInAppNotifications,
  subscribeInAppNotifications,
} from '@/storage/inAppNotifications';
import { colors, gradients, layout, motion, radii, typography } from '@/theme/tokens';

/**
 * How much of the available height the sheet covers when it first arrives.
 *
 * Short of full on purpose: the backdrop staying visible along the top edge is what says this is a
 * panel over the screen rather than a screen of its own, and it leaves somewhere to tap to leave.
 * Dragging up from here takes it to all of it.
 */
const REST_RATIO = 0.66;

/** Stand-in until the first layout pass measures the real host. Only ever one frame. */
const HOST_FALLBACK = 900;

/**
 * How far a release is projected past where the finger stopped, in seconds of its own velocity.
 *
 * This is what makes a flick land where it was aimed instead of where it was let go. Without it
 * the sheet snaps to whatever it happened to be nearest at release, so a fast downward flick from
 * fullscreen would stop at the resting height rather than closing.
 */
const FLICK_PROJECTION = 0.13;

export function NotificationsPanel({
  latestNews,
  topGainer,
  topLoser,
}: {
  readonly latestNews: MarketNewsArticle | null;
  readonly topGainer: string | null;
  readonly topLoser: string | null;
}) {
  const reduceMotion = useReducedMotion();
  // `mounted` keeps the modal in the tree; `offset` is where the sheet sits. A dismissal has to
  // finish travelling before the modal can unmount, so one boolean cannot express both.
  const [mounted, setMounted] = useState(false);
  const [hostHeight, setHostHeight] = useState(0);
  const presented = useRef(false);
  /** Usable height inside the safe area. Every snap point is a fraction of it. */
  const host = useSharedValue(HOST_FALLBACK);
  /** Translation from fullscreen: 0 is the top of the host, `host` is fully off the bottom. */
  const offset = useSharedValue(HOST_FALLBACK);
  const dragStart = useSharedValue(0);

  const activity = useSyncExternalStore(
    subscribeInAppNotifications,
    readInAppNotifications,
    readInAppNotifications,
  );
  const unread = countUnreadInAppNotifications(activity);

  // Held back until the host has been measured, because every snap point is derived from that
  // height — presenting against the fallback would settle the sheet at the wrong place and then
  // correct itself once the real number arrived.
  useEffect(() => {
    if (!mounted) {
      presented.current = false;
      return;
    }
    if (hostHeight === 0 || presented.current) return;

    presented.current = true;
    const rest = hostHeight * (1 - REST_RATIO);
    offset.set(hostHeight);
    offset.set(reduceMotion ? rest : withSpring(rest, motion.sheet));
  }, [hostHeight, mounted, offset, reduceMotion]);

  const close = useCallback(() => {
    if (reduceMotion) {
      setMounted(false);
      return;
    }

    offset.set(withSpring(host.value, motion.sheet, (finished) => {
      'worklet';
      if (finished === true) runOnJS(setMounted)(false);
    }));
  }, [host, offset, reduceMotion]);

  /**
   * Drag to resize or dismiss, snapping to the nearest of three positions: fullscreen, resting,
   * and gone. Nearest to where the flick was heading rather than to where it stopped.
   *
   * The sheet applies this to its grabber and title block, not to the list below. A pan over the
   * list would have to arbitrate with the scroll view for every downward swipe — the usual source
   * of sheets that refuse to scroll or refuse to close — whereas the header can never be ambiguous
   * about which one the finger meant. It covers the full width and both rows, so the 4pt bar is
   * only the affordance and not the target.
   */
  const drag = useMemo(() => Gesture.Pan()
    // A tap has to survive crossing this area, because the close button sits inside it. Nothing
    // claims the touch until the finger has committed to a vertical direction.
    .activeOffsetY([-8, 8])
    .onStart(() => {
      dragStart.set(offset.value);
    })
    .onUpdate((event) => {
      // Clamped at both ends: the sheet cannot be dragged above the host or torn past the bottom.
      const next = dragStart.value + event.translationY;
      offset.set(Math.min(Math.max(next, 0), host.value));
    })
    .onEnd((event) => {
      const rest = host.value * (1 - REST_RATIO);
      const projected = offset.value + event.velocityY * FLICK_PROJECTION;

      let target = 0;
      let nearest = Math.abs(projected);

      const toRest = Math.abs(projected - rest);
      if (toRest < nearest) {
        target = rest;
        nearest = toRest;
      }
      if (Math.abs(projected - host.value) < nearest) target = host.value;

      if (target === host.value) {
        offset.set(withSpring(host.value, motion.sheet, (finished) => {
          'worklet';
          if (finished === true) runOnJS(setMounted)(false);
        }));
        return;
      }

      offset.set(withSpring(target, motion.sheet));
    }), [dragStart, host, offset]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  // Tied to the sheet's position rather than to a separate timeline, so dragging the sheet down
  // lightens the backdrop with it and the two never disagree about how far along the exit is.
  // Full strength anywhere at or above the resting height, including fullscreen.
  const backdropStyle = useAnimatedStyle(() => {
    const rest = host.value * (1 - REST_RATIO);
    const span = host.value - rest;

    return {
      opacity: span <= 0
        ? 0
        : 1 - Math.min(Math.max((offset.value - rest) / span, 0), 1),
    };
  });

  const onHostLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height;
    host.set(measured);
    setHostHeight(measured);
  }, [host]);

  return (
    <>
      {/* The badge has to escape the disc, and the disc has to clip its own material, so the
          two cannot be the same view: the wrapper stays unclipped and holds both. */}
      <View style={styles.triggerWrapper}>
        <PressableScale
          accessibilityHint="Opens trade, funding, withdrawal, and wallet events"
          accessibilityLabel={unread === 0
            ? `Notifications, ${activity.length} events`
            : `Notifications, ${unread} unread of ${activity.length} events`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setMounted(true)}
          style={styles.trigger}
        >
          <LinearGradient
            colors={gradients.cardSheen.colors}
            locations={gradients.cardSheen.locations}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
          >
            <BellIcon />
          </View>
        </PressableScale>
        {/* Unread, not total. A count that never cleared would make the badge a permanent
            decoration, and clearing it is what the sheet's read actions are for. */}
        {unread > 0 ? (
          <View accessibilityElementsHidden pointerEvents="none" style={styles.badge}>
            <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
      </View>

      <Modal
        // The presentation is ours: `animationType` would run a second, unsprung transition
        // underneath this one and the two would fight over the same frames.
        animationType="none"
        onRequestClose={close}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={mounted}
      >
        {/* Its own gesture root, and this is the whole reason dragging did nothing before. A
            React Native `Modal` mounts into a separate native view hierarchy, outside the
            `GestureHandlerRootView` at the top of the app — so gesture-handler had nothing
            intercepting touches in here and the pan never received a single event. Modal content
            has to install its own root. */}
        <GestureHandlerRootView style={styles.overlay}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
            <Pressable
              accessibilityLabel="Close notifications"
              accessibilityRole="button"
              onPress={close}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          {/* A modal renders outside the screen tree, so it is on its own for insets — this is the
              one place besides AppScreen and the tab bar that reads them. Measured from the inner
              view rather than the SafeAreaView, whose own height still includes the insets. */}
          <SafeAreaView edges={['top', 'bottom']} pointerEvents="box-none" style={styles.safeArea}>
            <Animated.View onLayout={onHostLayout} style={[styles.sheetHost, sheetStyle]}>
              <NotificationsSheet
                activity={activity}
                dragGesture={drag}
                latestNews={latestNews}
                onClose={close}
                topGainer={topGainer}
                topLoser={topLoser}
                unread={unread}
              />
            </Animated.View>
          </SafeAreaView>
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}

/**
 * Drawn in `textSecondary` rather than `textPrimary`. This sits across the header from the
 * avatar, which carries a full-colour portrait, and the two discs are otherwise identical — so
 * the glyph is the only thing holding them apart.
 */
function BellIcon() {
  return (
    <Svg height={22} viewBox="0 0 24 24" width={22}>
      <Path
        d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8ZM10 21h4"
        fill="none"
        stroke={colors.textSecondary}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.9}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  triggerWrapper: { position: 'relative' },
  trigger: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    backgroundColor: colors.glassTint,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.background,
    backgroundColor: colors.accent,
  },
  badgeText: { ...typography.eyebrow, fontSize: 9, color: colors.onAccent },
  overlay: { flex: 1 },
  // Its own layer so the fade never touches the sheet's opacity: dimming the sheet as it
  // travelled would make it read as a projection rather than as a panel.
  backdrop: { backgroundColor: 'rgba(5, 5, 9, 0.72)' },
  safeArea: { flex: 1 },
  // Full height, so dragging to the top leaves no gap beneath the sheet. Where it actually sits
  // is the transform's business, not the layout's.
  sheetHost: { flex: 1 },
});
