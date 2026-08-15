/**
 * Held as constants because the loss and gain hues do double duty: they are the price
 * colours, and they are also the two ends of the sentiment scale below. Naming them once
 * keeps a red on a falling price and a red on an extreme-fear reading the same red.
 */
const NEGATIVE = '#EF6262';
const POSITIVE = '#4ADE80';

export const colors = {
  background: '#07060B',
  surface: '#101116',
  surfaceElevated: '#171820',
  border: '#292A35',
  borderStrong: '#3A3B48',
  textPrimary: '#FFFFFF',
  textSecondary: '#BDB8CC',
  textMuted: '#8B8798',
  accent: '#8B5CF6',
  accentPressed: '#7447E8',
  accentSoft: '#C4B5FD',
  positive: POSITIVE,
  negative: NEGATIVE,
  /** Rim shades for the action materials, one step under each gradient's base. */
  longEdge: '#178F52',
  shortEdge: '#B03737',
  accentEdge: '#6D28D9',

  /**
   * Fear and Greed bands, extreme fear through extreme greed.
   *
   * The ends are the app's own loss and gain hues rather than new reds and greens, so the
   * scale agrees with every price on the screen and a reader learns one colour language,
   * not two. Only the three middle steps are new, and they interpolate between those ends
   * through amber — the route that keeps every step distinguishable at the height of a
   * meter bar, which a direct red-to-green ramp does not.
   */
  sentimentExtremeFear: NEGATIVE,
  sentimentFear: '#F2935C',
  sentimentNeutral: '#EBCB65',
  sentimentGreed: '#A6CF6A',
  sentimentExtremeGreed: POSITIVE,

  onAccent: '#FFFFFF',
  onLight: '#111116',
  lightAction: '#F5F3FA',
  scrim: '#050509',

  // Onboarding backdrop ramp: black -> indigo -> violet -> off-white bloom.
  backdropTop: '#07060B',
  backdropDeep: '#1B1436',
  backdropViolet: '#4B2FA8',
  bloomMid: '#9B79EE',
  bloomHighlight: '#D3B6F2',
  bloomCore: '#F4ECFA',

  // Hairline strokes for the cropped arcs.
  hairline: '#FFFFFF',

  // Dark circular action that sits on top of the bloom.
  darkAction: '#08070C',

  // Translucent action surfaces.
  glassTextShadow: 'rgba(40, 8, 72, 0.7)',
  /**
   * Edge for glass surfaces. Tinted with the violet ramp rather than plain
   * white, so it defines the rim without drawing a hard outline around it.
   */
  glassEdge: 'rgba(196, 181, 253, 0.32)',

  /**
   * Floating tab bar. The blur behind it supplies the depth; these only tint it:
   * `glassTint` darkens the capsule so light content scrolling underneath cannot
   * wash out the icons, `glassRim` is the faint edge that keeps the capsule's
   * shape legible against a dark page, and `glassHighlight` is the sliding pill
   * behind the selected tab.
   *
   * The rim and the pill are drawn in the violet ramp rather than in plain white, the
   * same reasoning as `glassEdge`: a neutral white edge on a violet-cast surface reads
   * as a hard outline laid over the app, while the ramp defines the same shape as part
   * of it. The rim carries slightly more alpha than the white it replaced, because a
   * tinted film reads dimmer than a neutral one at equal opacity.
   *
   * `glassHighlight` takes the ramp's deep end and `glassSelected` its bright end, and the
   * distance between them is the point: the pill has to fall away for the glyph to come
   * forward, so the two can never sit at the same value.
   *
   * `glassSelected` is a violet, not an off-white. It went through near-white — `#DDCEFF`, then
   * `#EFE6FF` — chasing luminance, and both landed on the same problem: at that lightness the
   * hue is gone, so the selected tab was carried by the pill's shade rather than by the glyph,
   * and the glyph itself read as plain white. Selection is a statement about colour here, and
   * this is the palette's pastel violet, held deliberately at the same value as `accentSoft` so
   * an active tab and an active filter tab agree on what "chosen" looks like. It stays well
   * clear of the pill beneath it without giving up its hue to do so.
   *
   * `glassHighlight` stays translucent. An opaque pill was tried and reverted: it turned
   * selection into a block of colour competing with the glyph sitting on it, and put a solid
   * patch in the middle of a bar whose whole purpose is that content reads through it.
   */
  glassTint: 'rgba(10, 10, 12, 0.55)',
  glassRim: 'rgba(196, 181, 253, 0.14)',
  glassHighlight: 'rgba(75, 47, 168, 0.34)',
  glassSelected: '#C4B5FD',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  jumbo: 56,
} as const;

export const radii = {
  /**
   * Dense chrome: a search field, a column header, anything that frames data.
   * Enough to take the hard point off a corner, not enough to read as a pill —
   * at these heights a larger radius starts to curve the whole edge.
   */
  xs: 4,
  sm: 10,
  md: 16,
  lg: 24,
  panel: 32,
  pill: 999,
} as const;

/**
 * Font faces and the type scale live in `./fonts` and are re-exported here so
 * `@/theme/tokens` stays the single barrel for design tokens. Import either
 * path; both resolve to the same objects.
 */
export { fonts, typography, type FontFace } from './fonts';

/**
 * Full-screen onboarding gradients.
 *
 * The base ramp supplies luminosity. The two edge ramps begin at the lower
 * corners and become fully transparent before the centre of the screen; they
 * tint the base without introducing clipped shapes or visible boundaries.
 */
export const gradients = {
  onboardingField: {
    colors: [
      '#050407',
      '#050407',
      '#080612',
      '#120C27',
      '#29175C',
      '#5935B5',
      '#A98BE4',
      '#F5EFFA',
    ],
    locations: [0, 0.38, 0.49, 0.6, 0.71, 0.82, 0.92, 1],
  },
  /**
   * Ambience for the reader's own screens — home and profile: a violet rise behind the header
   * that has resolved into the page by the time the content below it starts.
   *
   * The onboarding field could not be reused as-is even though this is the same idea — that ramp
   * blooms to near-white at the bottom of the screen, which is a hero treatment and would put
   * the markets list on white. This one runs the other way and stops: brightest at the top where
   * the identity and the balance sit, `background` from a little past halfway down, so everything
   * that scrolls past reads against the same surface it always did.
   */
  ambientField: {
    colors: ['#3E2C86', '#261B56', '#120D28', '#07060B'],
    locations: [0, 0.26, 0.58, 1],
  },
  /**
   * Profile header panel: the ambient field's own light, in a smaller room.
   *
   * The first two stops are the home backdrop's, unchanged, because this has to read as the
   * same gradient. What differs is where it ends: the backdrop runs all the way down to
   * `background` because it covers a whole screen and everything below the header has to sit on
   * the page. This one completes inside a panel a couple of hundred points tall, so it stops at
   * a deep violet instead — the panel keeps a visible bottom edge for the avatar to straddle,
   * which a ramp that resolved to the page colour would not have.
   */
  profilePanel: {
    colors: ['#3E2C86', '#261B56', '#191138'],
    locations: [0, 0.55, 1],
  },
  /**
   * Glow rising from the bottom edge of the profile band, laid over the ramp above.
   *
   * A second layer rather than more stops on `profilePanel`, because the two do opposite things:
   * that ramp darkens downward, and this lifts the last third of it back up. Folding both into one
   * set of stops would mean a ramp that reverses on itself, which is impossible to reason about the
   * next time either end needs adjusting.
   *
   * Transparent well past the midpoint so it never touches the top of the band, and built from the
   * accent and its pastel rather than white — a white bloom on a violet surface desaturates as it
   * brightens, and the glow would drift off the palette exactly where it is strongest.
   *
   * It also lights the edge the avatar straddles, which is the reason the disc reads as sitting in
   * the band rather than in front of it.
   */
  profileGlow: {
    colors: [
      'rgba(139, 92, 246, 0)',
      'rgba(139, 92, 246, 0.16)',
      'rgba(167, 139, 250, 0.44)',
    ],
    locations: [0, 0.6, 1],
  },
  onboardingCoolEdge: {
    colors: [
      'rgba(74, 72, 204, 0.62)',
      'rgba(103, 112, 226, 0.22)',
      'rgba(103, 112, 226, 0)',
    ],
    locations: [0, 0.36, 1],
  },
  onboardingWarmEdge: {
    colors: [
      'rgba(195, 92, 226, 0.54)',
      'rgba(218, 145, 239, 0.2)',
      'rgba(218, 145, 239, 0)',
    ],
    locations: [0, 0.36, 1],
  },
  /**
   * Raised neutral surface: a shallow ramp from a lit top edge to a deeper base,
   * in the palette's greys. Reserved for chrome that frames data — a search field,
   * a column header — and deliberately kept off the data itself: run across every
   * row of a table it stops reading as a surface and starts reading as stripes.
   */
  surfaceRaise: {
    colors: ['#191A22', '#0E0F14'],
    locations: [0, 1],
  },
  /**
   * Order actions. Each ramp runs from a lit top edge to a deeper base, which is
   * what gives a small button its dimension: the fill reads as a curved surface
   * catching light rather than as a flat block of colour. Paired with the edge
   * colours below, which darken the rim on all four sides.
   */
  longAction: {
    colors: ['#5CE79B', '#22B96C'],
    locations: [0, 1],
  },
  shortAction: {
    colors: ['#F58585', '#D64545'],
    locations: [0, 1],
  },
  /**
   * The same material in the accent, for a control that is neither a buy nor a sell — a settings
   * glyph's tile. Built to the order buttons' recipe rather than a flat fill of `accent`, so
   * every raised control in the app catches light the same way, and paired with `accentEdge`
   * below, which darkens its rim on all four sides.
   */
  accentAction: {
    colors: ['#A78BFA', '#7C3AED'],
    locations: [0, 1],
  },
  /**
   * Skeleton sheen. Transparent at both ends so the highlight has no edge, and
   * light enough that it reads as a reflection travelling over the placeholder
   * rather than as a second block of colour.
   */
  shimmer: {
    colors: [
      'rgba(255, 255, 255, 0)',
      'rgba(255, 255, 255, 0.07)',
      'rgba(255, 255, 255, 0)',
    ],
    locations: [0, 0.5, 1],
  },
  /**
   * Translucent CTA glass. The backdrop reads through the surface, and because
   * the tint darkens rather than lightens, the white label keeps its contrast
   * even where the ramp behind the button is at its brightest.
   */
  glassAction: {
    colors: ['rgba(32, 19, 64, 0.42)', 'rgba(12, 7, 26, 0.58)'],
    locations: [0, 1],
  },
  /**
   * Light along the top edge of a card. Far weaker than the glass sheen below, and it has
   * to be: that one sits on a control the size of a thumb, while this crosses a whole card,
   * and the same strength spread over that area stops reading as a lit edge and starts
   * reading as a second background.
   */
  cardSheen: {
    colors: ['rgba(255, 255, 255, 0.07)', 'rgba(255, 255, 255, 0)'],
    locations: [0, 0.55],
  },
  /**
   * Gloss down a meter tick. Strong at the top, almost gone by the middle, so a tick reads
   * as a rounded bar catching light from above rather than as a flat swatch of colour.
   *
   * White rather than a lightened version of each tick, so one gradient serves every colour
   * the scale can take and the highlight keeps the same strength across all of them instead
   * of drifting with the hue underneath.
   */
  meterGloss: {
    colors: [
      'rgba(255, 255, 255, 0.34)',
      'rgba(255, 255, 255, 0.08)',
      'rgba(255, 255, 255, 0)',
    ],
    locations: [0, 0.45, 1],
  },
  /**
   * Specular highlight along the top of the glass. It fades out well before the
   * midpoint, so it reads as a curved surface catching light rather than as a
   * second fill.
   */
  glassActionSheen: {
    colors: [
      'rgba(255, 255, 255, 0.22)',
      'rgba(255, 255, 255, 0.05)',
      'rgba(255, 255, 255, 0)',
    ],
    locations: [0, 0.4, 1],
  },
  /**
   * Scrim under floating chrome, densest at the screen edge the chrome is anchored to
   * and gone well before the far end of it.
   *
   * Built from `scrim` rather than from black. Both are near enough to black to look
   * identical in isolation, but the app's surfaces carry a violet cast, and a pure-black
   * ramp over them desaturates as it deepens — the darkest part of the fade drifts off
   * the palette exactly where it covers the most area.
   */
  chromeScrim: {
    colors: [
      'rgba(5, 5, 9, 0.7)',
      'rgba(5, 5, 9, 0.32)',
      'rgba(5, 5, 9, 0.08)',
      'rgba(5, 5, 9, 0)',
    ],
    locations: [0, 0.42, 0.68, 0.88],
  },
} as const;

export const layout = {
  screenPadding: spacing.xl,
  /**
   * Gutter below `compactWidth`. A dense screen buys column room back from the
   * margin rather than from the type or the data.
   */
  screenPaddingCompact: spacing.sm,
  /** Width under which a screen switches to the compact gutter. */
  compactWidth: 360,
  maxContentWidth: 520,
  minTouchTarget: 48,
} as const;

export const motion = {
  pressScale: 0.96,
  spring: {
    damping: 18,
    stiffness: 280,
    mass: 0.55,
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
  /**
   * Layout morph: a block changing size, and the page below it travelling to follow.
   *
   * A spring rather than a duration, because this is the one animation in the app the user did
   * not ask for — it is a correction for content changing underneath them, and a spring is what
   * makes that read as a physical settle instead of as a scripted transition. Damping ratio works
   * out just under 1 (about 0.87), so there is a whisper of settle at the end and no visible
   * bounce; a block of text arriving with a bounce reads as a toy.
   *
   * The important part is that one set of physics is shared by every view that participates.
   * Reanimated's `layout` animates a view's own frame and nothing else — siblings below it are
   * placed at their final positions on the very next frame — so a smooth vertical reflow needs
   * every box in the column animating on identical physics. Mixed timings would have each section
   * arrive at a different moment, which looks worse than no animation at all.
   *
   * Layout animations default to `ReduceMotion.System`, so this is already suppressed for anyone
   * who has asked for less motion and needs no manual guard.
   */
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
  /**
   * Tab-to-tab morph: the arriving screen settles the last couple of percent into its
   * resting size, so a switch reads as the destination arriving rather than sliding in.
   * `scale` is deliberately tiny — at full-screen size even two percent reads clearly,
   * while anything larger turns a settle into a zoom.
   *
   * Shorter than the app's other reveals on purpose. A tab is a lateral move between
   * peers, not an arrival somewhere new, and the settle has to be finished before the
   * user's attention reaches the content — held any longer it stops reading as motion
   * and starts reading as the screen being slow to respond.
   *
   * Above 1 rather than below. A screen scaled under its container shrinks away from
   * the edges and exposes a band of bare shell, which the tab pill's blur then samples
   * along the bottom — the switch would flash in the bar. Scaled over its container it
   * always covers, at the cost of a few composited pixels of overshoot that stay well
   * inside the safe area at this size.
   */
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
