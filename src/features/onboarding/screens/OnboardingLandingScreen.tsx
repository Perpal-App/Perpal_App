import { useRouter } from 'expo-router';
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
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width < 360;

  const handleContinue = () => {
    router.push('/access');
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

          <RiseInView delay={heroDelay(2)}>
            <Text
              accessibilityRole="header"
              style={[styles.title, compact && styles.compactTitle]}
            >
              Private trading.{`\n`}Your control.
            </Text>
          </RiseInView>

          <RiseInView delay={heroDelay(3)}>
            <Text style={styles.description}>
              Your wallet stays unlinked from your identity, and your signing key
              never leaves this device.
            </Text>
          </RiseInView>
        </View>

        <View style={styles.footer}>
          <GlassButton
            accessibilityHint="Opens sign in and account creation options"
            enterOffsetY={motion.rise.offsetY}
            fadeDelay={heroDelay(4)}
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
    lineHeight: 46,
  },
  spark: {
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.display,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  compactTitle: {
    fontSize: 36,
    lineHeight: 42,
  },
  description: {
    ...typography.bodyCompact,
    maxWidth: 336,
    marginTop: spacing.md,
    color: colors.textSecondary,
    textAlign: 'center',
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
