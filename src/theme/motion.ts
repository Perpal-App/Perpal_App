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
  /**
   * The rebound after a gooey press: how long the control takes to spring back past rest to its crest,
   * before the gooey spring settles it. Feedback only — the action has already run on release.
   */
  pressRebound: {
    crestMs: 140,
  },
  /** Cross-fade reveal: opacity only, no delay and no movement. */
  fade: {
    duration: 420,
  },
  /**
   * Concealing and revealing a figure, for the eye toggle on the balance headers.
   *
   * Eased at both ends rather than only on the way out, because this is one control run in two
   * directions and an asymmetric curve makes hiding and showing feel like different gestures. Long
   * enough to read as the number being veiled, short enough that nobody waits to see their balance.
   *
   * The value contracts slightly and lifts as it goes while the mask rises into its place, so the two
   * read as one thing replacing another rather than as two independent fades crossing over. Both legs
   * are transform and opacity only: several figures conceal at once on these screens, and anything
   * touching layout would reflow the whole card on every tap.
   *
   * `travel` is deliberately tiny. At a hero figure's size a longer slide reads as the balance
   * escaping upward, and the same distance applied to a 12pt tile figure looks like a glitch — a
   * couple of points is enough to give the fade a direction at every size it runs on.
   */
  conceal: {
    duration: 280,
    travel: 3,
    scale: 0.96,
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
  /**
   * Feather touch: the lightest acknowledgement in the app, for a small control that confirms and
   * then settles — the read tick on a notification.
   *
   * `dipScale` is shallow deliberately. The compression that reads as give on a full-width button
   * reads as a stutter on a 32pt disc, and the movement a finger actually registers at this size is
   * the halo leaving the control, not the glyph shrinking. Paired with a stiff, lightly damped
   * spring so the return is quick and carries one soft overshoot rather than stopping dead.
   *
   * The halo is a ring expanding out of the control's own edge and fading as it travels: scale and
   * opacity only, composited, never a layout dimension. It stops barely past the target because a
   * wide ripple on a small control reads as a material splash, which is a different language from
   * this app's.
   *
   * `commitMs` is the separate, slower leg — the outline filling in once the event is acknowledged.
   * Slower than the halo on purpose: the ripple is the reaction to the finger, the fill is the
   * state that outlives it, and running both at ripple speed made the change look like a flicker.
   */
  featherTouch: {
    dipScale: 0.9,
    spring: {
      damping: 13,
      stiffness: 320,
      mass: 0.4,
    },
    haloMs: 460,
    haloScale: 1.7,
    haloOpacity: 0.4,
    commitMs: 260,
  },
  layoutMorph: {
    damping: 22,
    stiffness: 190,
    mass: 0.85,
  },
  /**
   * The order ticket's keypad, and the figure it writes.
   *
   * The press halo arrives almost at once and leaves slowly: arriving is the acknowledgement, so it has
   * to land inside the touch, while the fade out is only there so the key does not blink. `haloFrom` is
   * the scale it grows out of.
   *
   * A digit rises `digitTravel` into its slot on `spring` and fades out on `digitExitMs` when deleted —
   * short, because a deleted digit is gone the moment the key is released and should look it.
   */
  keypad: {
    pressInMs: 70,
    releaseMs: 280,
    haloFrom: 0.72,
    digitTravel: 14,
    digitExitMs: 140,
  },
  /**
   * The refusal shake, for input that cannot be accepted — a seventh decimal, a second point.
   *
   * The passcode field's gesture: a few quick, shrinking swings either side of rest. Small enough to
   * read as "no" rather than as an error dialog, and it carries no colour change, so the figure stays
   * legible while it moves.
   */
  reject: {
    travel: 7,
    stepMs: 48,
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
   * The order ticket's sheet sliding up into place and back down off the screen.
   *
   * A plain slide on the curve iOS gives its own sheets: quick off the mark, then a long, soft deceleration,
   * with no overshoot, so the frame it lands on is the frame it stops. Timed rather than sprung, so it ends
   * exactly when it says and nothing waits on a spring's tail, either before the sheet can be used or, on
   * the way out, before it is gone. Leaving is quicker than arriving.
   */
  sheetSlide: {
    arriveMs: 340,
    leaveMs: 260,
    curve: [0.32, 0.72, 0, 1],
  },
  /**
   * A page pushed over another inside a sheet, and popped back off it: the order review over the ticket.
   *
   * A navigation push rather than a fade. The incoming page is opaque and slides in from the trailing edge
   * while the page it covers is carried `parallax` of the way the other way and dims out, so two pages'
   * contents are never drawn over each other — which is what a cross-fade between them did.
   *
   * A spring, so Back taken mid-push turns the page around from where it is, with its velocity, instead of
   * waiting for it to land. Critically damped: it lands once and does not bounce.
   */
  push: {
    spring: { duration: 360, dampingRatio: 1 },
    parallax: 0.3,
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
