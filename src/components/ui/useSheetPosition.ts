import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, type LayoutChangeEvent } from 'react-native';
import { runOnJS, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { restOffset, SHEET_ARRIVE, sheetLeave } from '@/components/ui/sheetMotion';
import { motion } from '@/theme/tokens';

/**
 * Where the sheet waits before it is presented: far enough down that neither it nor the backdrop, whose
 * strength follows the sheet's position, can show on any frame before the slide starts. Starting at 0 meant
 * "fully open", and the backdrop drew at full strength for the frames between the host being measured and
 * the arrival being armed.
 */
const OFFSCREEN = 10_000;

/**
 * Where a `DraggableSheet` is, and every way it moves except under the finger: the slide up when it is
 * wanted, the slide down when it is not, and the corrections a re-measured host needs.
 *
 * Opening and closing are one plain slide each, timed on the iOS sheet curve (`motion.sheetSlide`), from
 * wholly below the screen and back to wholly below it. The distance is the sheet plus the strip under it,
 * measured from layout rather than assumed, so a close ends on exactly the frame the sheet leaves the screen
 * and the modal goes with it — no spring tail to wait out, and no edge of sheet left under the home
 * indicator first.
 *
 * `offset` is the translation from filling the host: 0 is as tall as the sheet gets, `host` is off the bottom
 * of the host, and `gone` is off the bottom of the screen. The gesture reads and writes these directly and
 * reports a drag that ends in a close through `beginLeave` and `afterLeave`, so there is only ever one
 * departure under way.
 */
export function useSheetPosition({
  reduceMotion,
  restRatio,
  visible,
}: {
  readonly reduceMotion: boolean;
  readonly restRatio: number;
  readonly visible: boolean;
}) {
  // `mounted` keeps the modal in the tree; `offset` is where the sheet sits. A dismissal has to finish
  // travelling before the modal can unmount, so one boolean cannot express both.
  const [mounted, setMounted] = useState(false);
  const [hostHeight, setHostHeight] = useState(0);
  /**
   * The strip between the bottom of the sheet's area and the bottom of the screen: the bottom safe area.
   * Measured from layout, as the gap between the dock's bottom edge and the safe-area view's, rather than
   * read as an inset. It is what the sheet has to cross, besides its own height, to be off the screen.
   */
  const [bottomGap, setBottomGap] = useState<number | null>(null);
  const safeHeight = useRef(0);
  const dockBottom = useRef(0);
  const presented = useRef(false);
  const lastHost = useRef(0);
  /** Whether the parent currently wants the sheet open. */
  const wanted = useRef(visible);
  /** Between a slide up starting and landing, so a host re-measure mid-slide carries it on instead of cutting it. */
  const arriving = useRef(false);
  /** Between a departure starting and finishing, so a close and the drag that caused it start only one. */
  const leaving = useRef(false);
  /** Usable height inside the safe area and below the backdrop gap. Every resting position is measured in it. */
  const host = useSharedValue(0);
  const offset = useSharedValue(OFFSCREEN);
  const gone = useSharedValue(OFFSCREEN);
  const dragStart = useSharedValue(0);
  /**
   * Which of the two open positions the sheet is at.
   *
   * Tracked rather than inferred from `offset`, because the host it was measured against can change
   * underneath it. A shared value rather than a ref so the gesture can write it from the UI thread.
   */
  const expanded = useSharedValue(false);

  useEffect(() => {
    wanted.current = visible;
    if (visible) {
      setMounted(true);
      return;
    }
    presented.current = false;
  }, [visible]);

  useEffect(() => {
    if (hostHeight > 0 && bottomGap !== null) gone.set(hostHeight + bottomGap);
  }, [bottomGap, gone, hostHeight]);

  const finish = useCallback(() => {
    leaving.current = false;
    arriving.current = false;
    setMounted(false);
    setHostHeight(0);
    lastHost.current = 0;
    offset.set(OFFSCREEN);
  }, [offset]);

  const arrived = useCallback(() => {
    arriving.current = false;
  }, []);

  /** Slides to `target` from wherever the sheet is now, which also turns a departure around. */
  const slideTo = useCallback((target: number) => {
    leaving.current = false;
    arriving.current = true;
    offset.set(withTiming(target, SHEET_ARRIVE, (done) => {
      'worklet';
      if (done === true) runOnJS(arrived)();
    }));
  }, [arrived, offset]);

  const beginLeave = useCallback(() => {
    leaving.current = true;
    arriving.current = false;
  }, []);

  // A departure has finished. The modal goes with it — unless the parent kept the sheet after all, in which
  // case it comes back rather than sitting off the screen with the modal still up and taking every touch.
  const afterLeave = useCallback(() => {
    leaving.current = false;
    if (!wanted.current) {
      finish();
      return;
    }
    slideTo(restOffset(host.get(), restRatio));
  }, [finish, host, restRatio, slideTo]);

  // Presentation needs the host's measurement and the strip below it. It used to need the content's as
  // well and that was a bug: the content was still loading, and a zero reading meant this never ran at
  // all — leaving the sheet at the initial offset, which was wide open.
  useEffect(() => {
    if (!visible || hostHeight === 0 || bottomGap === null || presented.current) return;

    presented.current = true;
    // True when resting *is* expanded, which is what `restRatio: 1` means. The flag only decides which
    // position a host resize re-derives against, and at that ratio both of its branches come to the same
    // offset — but a flag reading "not expanded" about a sheet filling the host would mislead whoever
    // reads the resize effect next.
    expanded.set(restRatio >= 1);
    const target = restOffset(hostHeight, restRatio);
    if (reduceMotion) {
      leaving.current = false;
      offset.set(target);
      return;
    }
    // From just below the screen's bottom edge — unless it is still on its way out from a close a moment
    // ago, in which case it turns around from where it is instead of jumping down first.
    const below = hostHeight + bottomGap;
    if (offset.get() > below) offset.set(below);
    slideTo(target);
  }, [bottomGap, expanded, hostHeight, offset, reduceMotion, restRatio, slideTo, visible]);

  // Re-derives the current position against a host that has changed size, and does not change which
  // position that is.
  //
  // This effect used to expand the sheet on any host change, on the assumption that a host change meant
  // the keyboard. It does not. Android re-measures shortly after a translucent modal mounts, as its
  // insets settle, so the sheet would open at rest and then immediately run to full — which is the
  // "it opens fully" this was reported as, and the same false positive behind it getting stuck.
  //
  // Set rather than slid: a host resize is a layout correction, not a gesture, and animating it would
  // show a slide the reader did not ask for. Except mid-slide, where setting it would cut the slide short
  // and jump the sheet to where it was heading.
  useEffect(() => {
    if (hostHeight === 0) return;

    const previous = lastHost.current;
    lastHost.current = hostHeight;
    if (previous === 0 || previous === hostHeight || !presented.current || leaving.current) return;

    const target = expanded.value ? 0 : restOffset(hostHeight, restRatio);
    if (arriving.current) {
      // Expanded is 0 at any host height, so a slide heading there is already right.
      if (target !== 0) slideTo(target);
      return;
    }
    offset.set(target);
  }, [expanded, hostHeight, offset, restRatio, slideTo]);

  // The one thing that legitimately expands the sheet on its own. A field has focus and the keyboard has
  // taken most of the dock, so the most room available is what typing into one wants — and half of what
  // is left would be a few rows tall. Driven by the keyboard's own event rather than inferred from a
  // measurement, which is the distinction the effect above could not make.
  useEffect(() => {
    if (!mounted) return undefined;

    const shown = Keyboard.addListener('keyboardDidShow', () => {
      if (leaving.current) return;
      expanded.set(true);
      offset.set(reduceMotion ? 0 : withSpring(0, motion.sheet));
    });
    return () => shown.remove();
  }, [expanded, mounted, offset, reduceMotion]);

  // Runs the exit whenever the sheet stops being wanted. A close from a drag is already on its way out,
  // started from the gesture on the frame the finger let go, and is left to finish.
  useEffect(() => {
    if (visible || !mounted) return;

    if (reduceMotion) {
      finish();
      return;
    }
    if (leaving.current) return;

    beginLeave();
    const travel = gone.get();
    offset.set(withTiming(travel, sheetLeave(travel - offset.get(), travel), (done) => {
      'worklet';
      if (done === true) runOnJS(afterLeave)();
    }));
  }, [afterLeave, beginLeave, finish, gone, mounted, offset, reduceMotion, visible]);

  // Measured on the inner animated view rather than the `SafeAreaView`, whose own height still
  // includes the insets — measuring that yields positions that are all slightly wrong.
  const onHostLayout = useCallback((event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.height;
    host.set(measured);
    setHostHeight(measured);
  }, [host]);

  // The safe-area view fills the modal and the dock stops at its bottom inset, so the difference between
  // their bottom edges is the strip below the sheet's area, taken from layout.
  const measureBottomGap = useCallback(() => {
    if (safeHeight.current > 0 && dockBottom.current > 0) {
      setBottomGap(Math.max(safeHeight.current - dockBottom.current, 0));
    }
  }, []);
  const onSafeAreaLayout = useCallback((event: LayoutChangeEvent) => {
    safeHeight.current = event.nativeEvent.layout.height;
    measureBottomGap();
  }, [measureBottomGap]);
  const onDockLayout = useCallback((event: LayoutChangeEvent) => {
    const { height, y } = event.nativeEvent.layout;
    dockBottom.current = y + height;
    measureBottomGap();
  }, [measureBottomGap]);

  return {
    afterLeave,
    arrived,
    beginLeave,
    dragStart,
    expanded,
    gone,
    host,
    mounted,
    offset,
    onDockLayout,
    onHostLayout,
    onSafeAreaLayout,
  };
}
