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

  backgroundTinted: '#0C0916',
  surfaceTinted: '#15121D',
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
   * Depth behind an order-book row, and the two halves of its imbalance bar.
   *
   * Translucent by construction: the number sits on top of the fill, so it has to read
   * as size at a glance and still leave the digits legible. Both are the `positive` and
   * `negative` hues rather than new greens and reds, so a bid in the book is the same
   * green as a rising price two rows above it.
   *
   * The bar carries more alpha than the row because it is a solid block with its own
   * label rather than a wash behind live numbers.
   */
  depthBid: 'rgba(74, 222, 128, 0.15)',
  depthAsk: 'rgba(239, 98, 98, 0.15)',
  depthBidStrong: 'rgba(74, 222, 128, 0.24)',
  depthAskStrong: 'rgba(239, 98, 98, 0.22)',

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

  /** Floating tab-bar tint, rim, selected pill, and selected glyph. */
  glassTint: 'rgba(10, 10, 12, 0.55)',
  glassRim: 'rgba(196, 181, 253, 0.14)',
  glassHighlight: 'rgba(75, 47, 168, 0.34)',
  /** Chip fill on a violet panel. Lighter and denser than `glassHighlight`, which sank into it. */
  /**
   * The halo under a raised control, and the light caught along its top edge.
   *
   * The halo is dark, not light. On a mid-violet card a bloom has nothing to brighten against and
   * just washes the fill it is meant to separate, where a shadow reads immediately. The inset
   * highlight is the other half of the same effect: without it a dark pill on a dark card is a
   * silhouette, and the two together are what make it a surface catching light from above.
   */
  raisedHalo: 'rgba(5, 5, 9, 0.55)',
  raisedTopLight: 'rgba(255, 255, 255, 0.16)',
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

export { motion } from './motion';
