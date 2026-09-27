import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

/** A point in window coordinates: where a dialog grows from, and goes back to. */
export type DialogOrigin = { readonly x: number; readonly y: number };

/** Fast away, soft landing: the curve the sheets leave on, so every exit in the app moves alike. */
const CLOSE_CURVE = Easing.bezier(0.32, 0.72, 0, 1);
/** How long past its curve an exit may run before the dialog is taken down regardless. */
const CLOSE_GRACE_MS = 150;

/**
 * A dialog's arrival and departure, as one morph from the control that raised it.
 *
 * With an origin, the card starts as a small round shape over that control — a tenth of its size, its
 * corners a full half of its height — and grows into place while travelling to the middle of the screen, its
 * corners easing to their resting radius; its contents fade in only once it is most of the way there, so
 * nothing is ever seen squeezed. Dismissed, it runs the same path back into the control. Without an origin
 * it rises in place from just under full size.
 *
 * Transform, opacity and a corner radius only, all on the UI thread from one shared value, so the JavaScript
 * thread doing anything at all cannot make it stutter. The open waits one layout for the card's resting
 * place, so the first frame is never in the wrong spot. The exit is a fixed curve with a timer behind it:
 * the modal is gone on time even if the curve's end is never reported, because an invisible modal still in
 * front of the screen is what a stuck screen is. Under reduce motion it appears and goes in place.
 */
export function useDialogMorph({
  origin,
  radius,
  visible,
}: {
  readonly origin: DialogOrigin | null;
  /** The card's resting corner radius. */
  readonly radius: number;
  readonly visible: boolean;
}) {
  const reduceMotion = useReducedMotion();
  // `mounted` keeps the modal in the tree; `progress` is how far open the card is. A dismissal has to finish
  // travelling before the modal can unmount, so one boolean cannot express both.
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);
  const fromX = useSharedValue(0);
  const fromY = useSharedValue(0);
  const fromScale = useSharedValue<number>(motion.dialog.fromScale);
  const fromRadius = useSharedValue(radius);
  /** The card's resting centre and height, from its layout each time it is shown. */
  const rest = useRef<{ readonly height: number; readonly x: number; readonly y: number } | null>(null);
  const waiting = useRef(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ origin, reduceMotion, visible });
  useEffect(() => {
    latest.current = { origin, reduceMotion, visible };
  });

  const stopFallback = useCallback(() => {
    if (fallback.current === null) return;
    clearTimeout(fallback.current);
    fallback.current = null;
  }, []);

  /** Points the morph at the origin, from wherever the card rests now. */
  const aim = useCallback(() => {
    const at = rest.current;
    if (at === null) return;
    const from = latest.current.origin;
    fromX.set(from === null ? 0 : from.x - at.x);
    fromY.set(from === null ? 0 : from.y - at.y);
    fromScale.set(from === null ? motion.dialog.fromScale : motion.dialog.fromControl);
    fromRadius.set(from === null ? radius : Math.max(at.height / 2, radius));
  }, [fromRadius, fromScale, fromX, fromY, radius]);

  const open = useCallback(() => {
    waiting.current = false;
    aim();
    progress.set(latest.current.reduceMotion ? 1 : withSpring(1, motion.dialog.open));
  }, [aim, progress]);

  const unmount = useCallback(() => {
    stopFallback();
    // A dialog asked for again while its exit was ending stays: the late report of that exit is stale.
    if (latest.current.visible) return;
    rest.current = null;
    setMounted(false);
  }, [stopFallback]);

  useEffect(() => {
    stopFallback();
    if (visible) {
      setMounted(true);
      // Shown again mid-exit it already has a layout and turns around at once; otherwise it waits for one.
      if (rest.current === null) waiting.current = true;
      else open();
      return;
    }
    waiting.current = false;
    if (latest.current.reduceMotion) {
      progress.set(0);
      unmount();
      return;
    }
    aim();
    progress.set(withTiming(0, { duration: motion.dialog.closeMs, easing: CLOSE_CURVE }, (finished) => {
      'worklet';
      if (finished === true) runOnJS(unmount)();
    }));
    fallback.current = setTimeout(unmount, motion.dialog.closeMs + CLOSE_GRACE_MS);
  }, [aim, open, progress, stopFallback, unmount, visible]);

  useEffect(() => stopFallback, [stopFallback]);

  const onCardLayout = useCallback((event: LayoutChangeEvent) => {
    const { height, width, x, y } = event.nativeEvent.layout;
    rest.current = { height, x: x + width / 2, y: y + height / 2 };
    if (waiting.current) open();
  }, [open]);

  const cardStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const remaining = 1 - p;
    return {
      opacity: interpolate(p, [0, 0.15], [0, 1], Extrapolation.CLAMP),
      borderRadius: interpolate(p, [0, 0.6], [fromRadius.value, radius], Extrapolation.CLAMP),
      transform: [
        { translateX: fromX.value * remaining },
        { translateY: fromY.value * remaining },
        { scale: fromScale.value + (1 - fromScale.value) * p },
      ],
    };
  });
  // Late in, early out: nothing inside is seen while the card is small.
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.45, 0.95], [0, 1], Extrapolation.CLAMP),
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  return { cardStyle, contentStyle, mounted, onCardLayout, scrimStyle };
}
