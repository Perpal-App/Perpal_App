/**
 * Motion tokens — durations, springs and offsets, in one place.
 *
 * Split out of `tokens.ts` rather than living in it: that file reached its 500-line ceiling, and
 * motion is the one group in it with no dependency on the colour, spacing or type scales. It is
 * re-exported from `@/theme/tokens`, exactly as `fonts` is, so `import { motion } from '@/theme/tokens'`
 * keeps working everywhere and no call site had to move.
 *
 * Durations are ms. Springs are Reanimated `WithSpringConfig` and are consumed on the UI thread, so a
 * value here never costs a JS frame.
 */

export const motion = {
  pressScale: 0.96,
  spring: {
    damping: 18,
    stiffness: 280,
    mass: 0.55,
  },
  /**
   * Squash for a chip press: the same stiffness so the response is immediate, a third of the damping
   * so it settles back through one soft overshoot. The give is the point — that is what reads as
   * gooey rather than as a rigid step — and it stays on the UI thread, so it cannot go choppy.
   */
  pressGooey: {
    damping: 11,
    stiffness: 280,
    mass: 0.5,
  },
  /** Cross-fade reveal: opacity only, no delay and no movement. */
  fade: {
    duration: 420,
  },
  /**
   * Staggered candle reveal. Each candle starts `stagger` ms after the one to
   * its left, so the series reads left to right. Because `duration` is much
   * longer than `stagger`, neighbouring fades overlap and the run lands as one
   * continuous sweep rather than eight separate steps.
   */
  candleReveal: {
    duration: 520,
    stagger: 95,
  },
  /**
   * Slide-and-fade reveal. `offsetY` is applied as a transform, so the travel is
   * composited and never moves anything in layout. `stagger` spaces consecutive
   * elements when several rise as one cascade.
   */
  rise: {
    duration: 520,
    offsetY: 18,
    stagger: 90,
  },
  /**
   * Gauge fill sweep: colour running across a row of ticks, left to right, once when a
   * reading arrives.
   *
   * `overlap` is the share of the sweep a single tick takes to come up, as a fraction. It
   * has to be well above one tick's share of the total or the ticks light one at a time and
   * the run reads as a counter ticking over; at this value each tick is still rising as
   * several of its neighbours start, so the fill reads as one front moving across.
   */
  gaugeFill: {
    duration: 640,
    overlap: 0.24,
  },
  /**
   * Bookmark toggle: the ribbon reacting to being saved, and to being given up.
   *
   * Deliberately asymmetric, because the two taps are not the same statement. Saving overshoots
   * — the glyph grows past its resting size and springs back, which is the shape of a
   * confirmation. Unsaving dips under instead and returns, acknowledging the tap without
   * celebrating it. One control, and the direction of the scale is what tells them apart.
   *
   * `popMs` and `dipMs` cover only the outbound leg; the return is `spring` in both cases, so
   * the settle carries the same elasticity as every other press in the app.
   *
   * The fill crossfades in faster than it goes out for the same reason. A saved state should
   * land with the pop, while a ribbon being emptied reads better draining than blinking off.
   */
  bookmarkToggle: {
    popScale: 1.3,
    dipScale: 0.84,
    popMs: 120,
    dipMs: 110,
    fillInMs: 140,
    fillOutMs: 190,
  },
  layoutMorph: {
    damping: 22,
    stiffness: 190,
    mass: 0.85,
  },
  /**
   * Bottom sheet presenting and dismissing.
   *
   * A spring rather than a duration curve, which is what makes it read as iOS rather than as a
   * web modal: the panel arrives with momentum and decelerates into place instead of easing
   * along a fixed path. `dampingRatio` sits just under 1 so it settles without a bounce — a
   * sheet that overshoots its own edge looks like a bug, not like polish.
   *
   * `duration` is the spring's perceptual settling time, not a keyframe length; Reanimated
   * solves the stiffness and mass from the pair. Long enough to feel like weight moving, short
   * enough that dismissing never feels like waiting for permission to leave.
   */
  sheet: {
    duration: 460,
    dampingRatio: 0.9,
  },
  /**
   * Dismissing a sheet, which is not the arrival played backwards.
   *
   * Critically damped and much shorter. `sheet` is tuned for something appearing — it settles, and a
   * damping ratio under 1 keeps a long asymptotic tail that reads as weight on the way in. Reused for
   * the exit that tail becomes a wait: the panel looks gone while the spring is still technically
   * running, and anything that fires on completion — unmounting the modal, releasing the backdrop —
   * happens noticeably after the sheet has left.
   *
   * At a ratio of exactly 1 there is no overshoot and no tail, so the sheet arrives at the bottom edge
   * once and the frame it lands on is the frame it finishes.
   */
  sheetDismiss: {
    duration: 240,
    dampingRatio: 1,
  },
  /**
   * How a row arrives when a filter swaps the set under it.
   *
   * `layout` alone cannot cover this. It animates the frame of a view that exists in both the old
   * and the new render, and a filter swap replaces the rows with different components under
   * different keys — so the ones that carry over slide, and the ones that are genuinely new have no
   * previous frame to travel from and would otherwise appear instantly. This is what those get.
   *
   * Short, and shorter than the morph spring on purpose: the rows should be readable while the box
   * around them is still settling, so the two read as one movement rather than a queue.
   */
  rowSwap: {
    fadeMs: 150,
  },
  /**
   * Skeleton sweep. One pass of the highlight across a placeholder, looped while
   * data is pending. Slow enough to read as "working" rather than "spinning",
   * and every skeleton on screen shares a single clock so the sheen moves as one
   * front instead of a field of independent flickers.
   */
  shimmer: {
    duration: 1_150,
  },
  tabSwitch: {
    duration: 200,
    scale: 1.02,
  },
  /**
   * Backdrop slide-up on entry. Ease-out reads as fast-then-smooth: the gradient
   * rushes up and decelerates into place. `offsetRatio` is a fraction of screen
   * height so the travel scales with the device, and `contentDelay` holds the
   * logo and text back just until the panel is settling — not long enough to
   * feel like a wait.
   */
  backdropSlide: {
    duration: 560,
    offsetRatio: 0.16,
    contentDelay: 300,
  },
} as const;
