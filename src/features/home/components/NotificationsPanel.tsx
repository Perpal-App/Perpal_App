import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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
 * How far the sheet starts below its resting place on the first present, before it has been
 * measured. Any value at least as tall as the sheet works — it only has to begin off-screen —
 * and one layout pass later the real height takes over.
 */
const TRAVEL_FALLBACK = 640;

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
  // Two states, not one. `mounted` keeps the modal in the tree, `presented` drives the spring —
  // a dismissal has to finish animating before the modal can unmount, and a single boolean would
  // tear the sheet off the screen on the first frame of its own exit.
  const [mounted, setMounted] = useState(false);
  const presented = useSharedValue(0);
  const travel = useSharedValue(TRAVEL_FALLBACK);
  const activity = useSyncExternalStore(
    subscribeInAppNotifications,
    readInAppNotifications,
    readInAppNotifications,
  );
  const unread = countUnreadInAppNotifications(activity);

  useEffect(() => {
    if (!mounted) return;

    presented.set(reduceMotion ? 1 : withSpring(1, motion.sheet));
  }, [mounted, presented, reduceMotion]);

  const close = useCallback(() => {
    if (reduceMotion) {
      presented.set(0);
      setMounted(false);
      return;
    }

    presented.set(withSpring(0, motion.sheet, (finished) => {
      'worklet';
      // Only on a completed exit. An interrupted spring means something re-presented the sheet,
      // and unmounting then would close it out from under that.
      if (finished === true) runOnJS(setMounted)(false);
    }));
  }, [presented, reduceMotion]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: presented.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - presented.value) * travel.value }],
  }));

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
          {/* Built from the same layers as the avatar across the header from it, down to the
              rim, so the two read as a matched pair bracketing the greeting. */}
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
        // underneath the one below and the two would fight over the same frames.
        animationType="none"
        onRequestClose={close}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={mounted}
      >
        <View style={styles.overlay}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
            <Pressable
              accessibilityLabel="Close notifications"
              accessibilityRole="button"
              onPress={close}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>

          {/* A modal renders outside the screen tree, so it is on its own for insets — this is
              the one place besides AppScreen and the tab bar that reads them. */}
          <SafeAreaView edges={['top', 'bottom']} pointerEvents="box-none" style={styles.safeArea}>
            <Animated.View
              onLayout={(event) => travel.set(event.nativeEvent.layout.height)}
              style={sheetStyle}
            >
              <NotificationsSheet
                activity={activity}
                latestNews={latestNews}
                onClose={close}
                topGainer={topGainer}
                topLoser={topLoser}
                unread={unread}
              />
            </Animated.View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

/**
 * Drawn in `textSecondary` rather than `textPrimary`. This sits across the header from the
 * avatar, which carries a full-colour portrait, and the two discs are otherwise identical — so
 * the glyph is the only thing holding them apart. A pure-white bell would make the control the
 * louder of the pair, and it is the identity that should lead.
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
  // Glass over the home screen's gradient, matching the avatar across the header from it. An
  // opaque disc on a gradient reads as a hole; this one lets the ramp through.
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
  overlay: { flex: 1, justifyContent: 'flex-end' },
  // Its own layer so the fade is animated without touching the sheet's opacity: dimming the
  // sheet as it travelled would make it read as a projection rather than as a panel.
  backdrop: { backgroundColor: 'rgba(5, 5, 9, 0.72)' },
  safeArea: { width: '100%', maxHeight: '92%' },
});
