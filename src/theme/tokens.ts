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
  sm: 10,
  md: 16,
  lg: 24,
  panel: 32,
  pill: 999,
} as const;

/**
 * Font families embedded natively at build time (see the expo-font plugin in
 * app.config.ts). The family string is identical on iOS and Android.
 */
export const fonts = {
  brand: 'Patrick Hand',
} as const;

export const typography = {
  wordmark: {
    // Patrick Hand is a handwriting face; heavy tracking breaks its flow, so
    // the letters keep only a light, breathable gap. Sized to read as a brand
    // mark without competing with the headline below it.
    fontFamily: fonts.brand,
    fontSize: 46,
    lineHeight: 52,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
  },
  display: {
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '700' as const,
    letterSpacing: -1.5,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700' as const,
    letterSpacing: -0.8,
  },
  heading: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600' as const,
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  bodyCompact: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400' as const,
  },
  label: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600' as const,
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
    letterSpacing: 1.4,
  },
} as const;

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
  primaryAction: {
    // Fully opaque so the CTA remains high contrast and can composite as one
    // inexpensive layer during its entrance animation.
    colors: ['#9868FF', '#7A3FEA', '#5C25C4'],
    locations: [0, 0.5, 1],
  },
} as const;

export const layout = {
  screenPadding: spacing.xl,
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
} as const;
