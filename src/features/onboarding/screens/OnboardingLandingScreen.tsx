import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import {
  CANDLE_REVEAL_TOTAL_DURATION,
  CandleChartMark,
} from '@/assets/svg/CandleChartMark';
import { SparkMark } from '@/assets/svg/SparkMark';
import { AppScreen } from '@/components/layout/AppScreen';
import { FadeInView } from '@/components/motion/FadeInView';
import { RiseInView } from '@/components/motion/RiseInView';
import { GlassButton } from '@/components/ui/GlassButton';
import { OnboardingBackdrop } from '@/features/onboarding/components/OnboardingBackdrop';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, motion, spacing, typography } from '@/theme/tokens';

/** The candle backdrop settles at half strength so it stays behind the wordmark. */
const CANDLE_OPACITY = 0.5;

/**
 * The hero enters as one cascade that picks up where the candle sweep ends: the
 * wordmark reveals first, then each element below it follows a `stagger` apart.
 * Deriving every delay from the candle total keeps the whole intro in sync when
 * any single timing is retuned.
 */
const heroDelay = (step: number) =>
  CANDLE_REVEAL_TOTAL_DURATION + step * motion.rise.stagger;

export function OnboardingLandingScreen() {
  const { markOnboardingIntroSeen } = useAppPreferences();
  const { width } = useWindowDimensions();
  const compact = width < 360;

  const handleContinue = () => {
    // This bounded, non-sensitive preference is written from the user event,
    // never during render. The root guard then exposes only the auth route.
    markOnboardingIntroSeen();
  };

  return (
    <AppScreen background={<OnboardingBackdrop />}>
      <View style={[styles.content, compact && styles.compactContent]}>
        <View style={styles.hero}>
          <View style={styles.brandMark}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={styles.candleLayer}
            >
              <CandleChartMark />
            </View>

            {/* Held back until the candle sweep lands, so the wordmark reads as
                the payoff of the chart animation rather than competing with it. */}
            <FadeInView delay={heroDelay(0)}>
              <Text style={[styles.wordmark, compact && styles.compactWordmark]}>
                Perpal
              </Text>
            </FadeInView>
          </View>

          <RiseInView
            accessibilityElementsHidden
            delay={heroDelay(1)}
            importantForAccessibility="no-hide-descendants"
            style={styles.spark}
          >
            <SparkMark size={compact ? 180 : 200} />
          </RiseInView>

          {/* One row, and it has to be pinned to one: three words at display size measure wider
              than a 360pt phone's content column, so left alone the line would break after
              "Test." and read as a sentence that ran out of room. `numberOfLines` forbids the
              break and `adjustsFontSizeToFit` gives the type licence to shrink instead — which is
              also what keeps the row intact at large accessibility text sizes, where a fixed size
              would clip. `minimumFontScale` stops the shrinking well before it stops being a
              heading. */}
          <RiseInView delay={heroDelay(2)}>
            <Text
              accessibilityRole="header"
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              numberOfLines={1}
              style={[styles.title, compact && styles.compactTitle]}
            >
              Learn. Test. Trade.
            </Text>
          </RiseInView>
        </View>

        <View style={styles.footer}>
          <GlassButton
            accessibilityHint="Opens sign in and account creation options"
            enterOffsetY={motion.rise.offsetY}
            fadeDelay={heroDelay(3)}
            fadeDuration={motion.rise.duration}
            fadeIn
            label="Get Started"
            onPress={handleContinue}
            style={styles.nextButton}
          />
        </View>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    // `flexGrow` (not `flex`) so the column can exceed the viewport and scroll
    // on small screens or at large text sizes. With `flex: 1` the column is
    // pinned to the viewport height and the footer gets clipped with no way to
    // scroll to it. AppScreen's scroll content already grows to the viewport,
    // so no percentage height is involved.
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  compactContent: {
    paddingHorizontal: spacing.lg,
  },
  hero: {
    // Takes the leftover height so the composition centres between the top of
    // the column and the footer, without squashing its own children.
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMark: {
    width: '100%',
    alignItems: 'center',
    // Reserve room above the word so the candles sit behind empty space and
    // fade out before they reach the letters.
    paddingTop: 168,
    marginBottom: spacing.xxl,
  },
  candleLayer: {
    position: 'absolute',
    // Lifted above the reserved space so the series sits a little higher.
    top: -36,
    // Negative insets cancel the screen padding so the series bleeds to the
    // device edges instead of stopping inside the content column.
    left: -layout.screenPadding,
    right: -layout.screenPadding,
    height: 210,
    // Static: each candle animates its own opacity, so fading this wrapper too
    // would compound with the stagger and blur the one-by-one reveal.
    opacity: CANDLE_OPACITY,
  },
  wordmark: {
    ...typography.wordmark,
    color: colors.textPrimary,
    textAlign: 'center',
    // Offset the trailing letter-spacing so the tracked word stays centred.
    paddingLeft: typography.wordmark.letterSpacing,
    // A soft shadow thickens the mark so it reads with more presence.
    textShadowColor: colors.glassTextShadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 12,
  },
  compactWordmark: {
    fontSize: 40,
    // Patrick Hand needs 1.36x its size to keep the "p" descender intact.
    lineHeight: 55,
  },
  spark: {
    marginBottom: spacing.xl,
  },
  // A step under `display`, which is the size the two-line heading this replaced was set at. The
  // full 36 needs about 322pt for one row and a 360pt phone offers 312, so the shrink-to-fit above
  // would be doing the work on every mid-size device rather than only at large text sizes. 32
  // clears the narrowest supported column outright and leaves the fallback for what it is for.
  //
  // `width: '100%'` because `adjustsFontSizeToFit` measures against the box it is given: a text
  // node sized to its own content has nothing to shrink into and the fit is computed against the
  // wrong width.
  title: {
    ...typography.display,
    width: '100%',
    fontSize: 32,
    lineHeight: 48,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  compactTitle: {
    fontSize: 28,
    lineHeight: 42,
  },
  footer: {
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  nextButton: {
    width: '100%',
    maxWidth: 280,
  },
});
