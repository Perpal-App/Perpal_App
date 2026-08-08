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
  positive: '#4ADE80',
  negative: '#EF6262',
  /** Rim shades for the order actions, one step under each gradient's base. */
  longEdge: '#178F52',
  shortEdge: '#B03737',

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
   */
  glassTint: 'rgba(10, 10, 12, 0.55)',
  glassRim: 'rgba(255, 255, 255, 0.10)',
  glassHighlight: 'rgba(255, 255, 255, 0.14)',
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
