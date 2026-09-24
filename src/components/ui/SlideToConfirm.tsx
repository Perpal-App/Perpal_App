import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { ActionButton } from '@/components/ui/ActionButton';
import { colors, gradients, motion, radii, spacing, typography } from '@/theme/tokens';

const TRACK_HEIGHT = 56;
/** Inset of the thumb inside the track, so the track's rim reads as a groove around it. */
const INSET = 4;
const THUMB_WIDTH = 62;

/**
 * How far along the travel a release commits.
 *
 * Not 1: asking for the last pixel means the gesture fails on a thumb that stops a hair short, and the
 * only recovery is to do the whole slide again. Not 0.5 either — half a track is close enough to a
 * flick to be reachable by accident, which is the thing this control exists to prevent.
 */
const COMMIT_RATIO = 0.82;

/**
 * Confirm by sliding, for an action whose cost is not recoverable.
 *
 * The point is not decoration, it is that the gesture cannot be produced by accident. A tap can happen
 * while a sheet is still settling, on a control that has just moved under the finger, or as the second
 * half of an impatient double tap; a deliberate travel of most of a track's width cannot. That makes it
 * the right last step for money leaving a wallet, and the wrong one for anything reversible.
 *
 * It replaces the platform alert this flow used to end in. An `Alert` is dismissed by whichever of two
 * words the thumb reaches first, in a typeface and palette belonging to no part of this app, and it
 * covers the figures the reader is being asked to check.
 *
 * A screen reader gets a plain button instead, and that is not a lesser fallback — a drag along a track
 * is not expressible through VoiceOver or TalkBack, so offering one and hoping the activate action
 * lands would leave the only path to a withdrawal behind a gesture the reader cannot make. The button
 * carries the same label and the same confirmation, and it is reached the same way: after the review it
 * sits under.
 */
export function SlideToConfirm({
  confirming = false,
  disabled = false,
  label,
  onConfirm,
  radius = radii.md,
  tone = 'accent',
  workingLabel,
}: {
  /** Locks the track and shows the thumb working. The caller owns the request. */
  readonly confirming?: boolean;
  readonly disabled?: boolean;
  /** What sliding will do — "Slide to send", not "Slide to confirm" where the verb is known. */
  readonly label: string;
  readonly onConfirm: () => void;
  readonly radius?: number;
  readonly tone?: 'accent' | 'negative' | 'positive';
  /** Shown in place of `label` once committed. */
  readonly workingLabel: string;
}) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [assisted, setAssisted] = useState(false);
  const progress = useSharedValue(0);
  const start = useSharedValue(0);
  const travel = Math.max(width - THUMB_WIDTH - INSET * 2, 0);
  const locked = disabled || confirming;

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (active) setAssisted(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'screenReaderChanged',
      (enabled) => setAssisted(enabled),
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  // Parked at the far end while the request runs, so the thumb stays where the finger left it instead of
  // springing home under a spinner.
  useEffect(() => {
    if (confirming) progress.set(reduceMotion ? 1 : withSpring(1, motion.spring));
  }, [confirming, progress, reduceMotion]);

  // Read through a ref so `commit` is stable and the gesture is built once, while still calling the
  // handler the current render passed. The caller's `onConfirm` closes over the plan being confirmed, so
  // capturing it in a worklet at mount would pin the gesture to the first plan of the session.
  const latest = useRef(onConfirm);
  useEffect(() => {
    latest.current = onConfirm;
  }, [onConfirm]);

  const commit = useCallback(() => {
    if (Platform.OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    latest.current();
  }, []);

  const drag = useMemo(() => Gesture.Pan()
    .enabled(!locked && travel > 0)
    // The track is inside a scrolling sheet, so the gesture has to claim the axis it wants before the
    // scroll view reads the same movement as a flick. A few points of sideways intent is enough.
    .activeOffsetX([-12, 12])
    .failOffsetY([-24, 24])
    .onBegin(() => {
      'worklet';
      // Where the thumb actually is, not zero. A second drag started while the first is still springing
      // home would otherwise jump the thumb to the new finger's origin.
      start.set(progress.value);
    })
    .onUpdate((event) => {
      'worklet';
      progress.set(Math.min(Math.max(start.value + event.translationX / travel, 0), 1));
    })
    // `onFinalize`, not `onEnd`: a gesture the scroll view steals or the system cancels never ends, and
    // a thumb left parked mid-track with no finger on it looks broken.
    .onFinalize(() => {
      'worklet';
      if (progress.value >= COMMIT_RATIO) {
        progress.set(withSpring(1, motion.spring));
        runOnJS(commit)();
        return;
      }
      progress.set(withSpring(0, motion.spring));
    }), [commit, locked, progress, start, travel]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * travel }],
  }));

  // The fill is a full-width layer slid in from the left rather than a width that grows, so the track
  // filling up is a composited transform and never a layout pass per frame.
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 1) * width }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.45], [1, 0], Extrapolation.CLAMP),
  }));

  if (assisted) {
    return (
      <ActionButton
        accessibilityHint="Signs and submits the withdrawal shown above"
        disabled={disabled}
        glow
        label={confirming ? workingLabel : label}
        loading={confirming}
        onPress={onConfirm}
        radius={radius}
        style={styles.assisted}
        tone={tone}
      />
    );
  }

  return (
    <View
      accessibilityHint="Slide the handle to the right edge to confirm"
      accessibilityLabel={confirming ? workingLabel : label}
      accessibilityRole="button"
      accessibilityState={{ busy: confirming, disabled: locked }}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.track, { borderRadius: radius }, locked && styles.trackLocked]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.fillClip, fillStyle]}>
        <LinearGradient
          colors={gradients[RAMPS[tone]].colors}
          end={{ x: 0.5, y: 1 }}
          locations={gradients[RAMPS[tone]].locations}
          start={{ x: 0.5, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      {/* One text node in both states rather than a second one laid over the first. The working label
          takes this one's place and its layout, so committing does not reflow the track and there is no
          absolutely positioned line to centre vertically by hand. */}
      <Animated.Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={[styles.label, confirming ? styles.labelWorking : labelStyle]}
      >
        {confirming ? workingLabel : label}
      </Animated.Text>

      <GestureDetector gesture={drag}>
        <Animated.View style={[styles.thumb, { borderRadius: radius - INSET }, thumbStyle]}>
          <LinearGradient
            colors={gradients[RAMPS[tone]].colors}
            end={{ x: 0.5, y: 1 }}
            locations={gradients[RAMPS[tone]].locations}
            start={{ x: 0.5, y: 0 }}
            style={[styles.thumbFill, { borderRadius: radius - INSET }]}
          >
            {confirming
              ? <IOSLoader color={colors.onAccent} />
              : <SlideArrow color={colors.onAccent} />}
          </LinearGradient>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const RAMPS = {
  accent: 'accentAction',
  negative: 'shortAction',
  positive: 'longAction',
} as const;

/** Two chevrons, so the mark reads as travel in a direction rather than as a single pointer. */
function SlideArrow({ color }: { readonly color: string }) {
  return (
    <Svg height={20} viewBox="0 0 24 24" width={20}>
      <Path
        d="M7 5.5 13.5 12 7 18.5M14 5.5 20.5 12 14 18.5"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.2}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  // A recess: hairline rim and the page colour, so the thumb reads as sitting in a groove rather than
  // on a second button. `overflow` keeps the fill inside the corner.
  track: {
    height: TRACK_HEIGHT,
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderCurve: 'continuous',
    backgroundColor: colors.background,
  },
  trackLocked: { opacity: 0.72 },
  // Carries the transform. The ramp inside it fills this, so the layer that moves is one view rather
  // than a gradient being re-laid-out.
  fillClip: { opacity: 0.32 },
  // Centred in the room to the right of the thumb rather than in the whole track, which is what makes
  // the handle read as sitting before the instruction. Measured: the longest label the withdraw flow
  // passes is "Slide to withdraw", 169pt at the 1.2x cap, against the 198pt this leaves on the narrowest
  // screen the app supports.
  label: {
    ...typography.action,
    paddingLeft: THUMB_WIDTH + spacing.sm,
    paddingRight: spacing.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // Full strength and the brighter tone: the instruction is a prompt, the working state is a fact.
  labelWorking: { color: colors.textPrimary },
  thumb: {
    position: 'absolute',
    top: INSET,
    left: INSET,
    width: THUMB_WIDTH,
    height: TRACK_HEIGHT - INSET * 2,
    borderCurve: 'continuous',
  },
  thumbFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  assisted: { width: '100%' },
});
