import { Easing } from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

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
export function restOffset(host: number, ratio: number): number {
  'worklet';
  return Math.max(host - host * ratio, 0);
}

/** The slide up into place: quick off the mark, then a long, soft landing. See `motion.sheetSlide`. */
export const SHEET_ARRIVE = {
  duration: motion.sheetSlide.arriveMs,
  easing: Easing.bezier(...motion.sheetSlide.curve),
} as const;

/**
 * Leaving eases out only gently. The arrival's long landing, on the way out, is the sheet's top edge crawling
 * the last few points under the bottom of the screen, which reads as it catching there.
 */
const LEAVE_CURVE = Easing.out(Easing.quad);
const LEAVE_MS = motion.sheetSlide.leaveMs;

/**
 * The shortest a departure may take, as a share of a full one, so a sheet a flick has carried almost off
 * the screen still leaves on the curve instead of vanishing.
 */
const MIN_LEAVE_SHARE = 0.4;

/**
 * The slide down off the screen, over a time in proportion to the distance still to go: a sheet dragged or
 * flicked most of the way down finishes quickly instead of taking a whole departure's time. A worklet, so a
 * drag's release can start it on the UI thread.
 */
export function sheetLeave(remaining: number, travel: number) {
  'worklet';
  const share = travel <= 0 ? 1 : Math.min(Math.max(remaining / travel, MIN_LEAVE_SHARE), 1);
  return { duration: LEAVE_MS * share, easing: LEAVE_CURVE };
}
