import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { DirectionIcon } from '@/assets/svg/DirectionIcon';
import { BrandMark } from '@/components/brand/BrandMark';
import { SuccessView } from '@/components/feedback/SuccessView';
import { AppScreen } from '@/components/layout/AppScreen';
import { FadeInView } from '@/components/motion/FadeInView';
import { RiseInView } from '@/components/motion/RiseInView';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { AuthFlowCard } from '@/features/auth/components/AuthFlowCard';
import { OnboardingBackdrop } from '@/features/onboarding/components/OnboardingBackdrop';
import { colors, layout, motion, spacing, typography } from '@/theme/tokens';

/**
 * The logo and text begin as the backdrop is settling, then cascade a step
 * apart. Kept short so the reveal never feels like a wait.
 */
const revealDelay = (step: number) =>
  motion.backdropSlide.contentDelay + step * motion.rise.stagger;

const successCopy = {
  title: 'You’re in',
  message: "You're logged in and ready to trade.",
} as const;

/**
 * Account-access screen. Privy identity and wallet wiring belongs to the
 * integration boundary and is intentionally not invoked from this screen.
 *
 * On entry the landing gradient (flipped so the bloom sits at the top) slides up
 * fast-then-smooth. The brand mark rides near the top over it, and the access
 * actions live in a bottom-sheet card.
 */
export function AuthAccessScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const compact = width < 360;
  const reduceMotion = useReducedMotion();

  const markSize = compact ? 112 : 132;

  // 0 = entering (shifted down, transparent), 1 = settled in place.
  const slide = useSharedValue(reduceMotion ? 1 : 0);
  const slideOffset = height * motion.backdropSlide.offsetRatio;

  useEffect(() => {
    if (reduceMotion) {
      slide.set(1);
      return;
    }

    slide.set(0);
    slide.set(
      withTiming(1, {
        duration: motion.backdropSlide.duration,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [reduceMotion, slide]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: slide.value,
    transform: [{ translateY: (1 - slide.value) * slideOffset }],
  }));

  // Set only after an actual Privy email/OAuth login resolves with a user.
  const [succeeded, setSucceeded] = useState(false);

  const handleBack = () => {
    router.back();
  };

  const handleDismissSuccess = () => setSucceeded(false);

  return (
    <AppScreen
      background={
        <Animated.View style={[styles.backdropSlide, backdropStyle]}>
          {/* Vertical flip places the landing bloom at the top instead of the
              bottom, while reusing the exact same gradient stack. */}
          <View style={styles.backdropFlip}>
            <OnboardingBackdrop />
          </View>
        </Animated.View>
      }
    >
      <View style={styles.content}>
        <View style={[styles.top, compact && styles.compactTop]}>
          <FadeInView style={styles.topBar}>
            <IconButton
              accessibilityHint="Returns to the Perpal introduction"
              accessibilityLabel="Go back"
              onPress={handleBack}
              size={48}
            >
              <DirectionIcon direction="left" size={22} />
            </IconButton>
          </FadeInView>

          <View style={styles.brand}>
            <RiseInView delay={revealDelay(0)}>
              <BrandMark size={markSize} />
            </RiseInView>

            <RiseInView delay={revealDelay(1)}>
              <Text style={[styles.wordmark, compact && styles.compactWordmark]}>
                Perpal
              </Text>
            </RiseInView>
          </View>
        </View>

        {/* One existing sheet owns the complete inline Privy-style flow. Its
            controls intentionally have no entrance or press-scale animation. */}
        {succeeded ? null : (
          <View style={styles.cardArea}>
            <Card style={styles.authCard}>
              <AuthFlowCard onAuthenticated={() => setSucceeded(true)} />
            </Card>
          </View>
        )}

        {/* Scrim and sheet stay inside AppScreen's content, so the safe-area
            inset bounds them. The sheet sits at the bottom of the inset area
            (flush, straight edge) rather than the physical edge, so the device's
            rounded screen corners never clip its square bottom into a curve. The
            scrim is an absolute sibling painted before the sheet, so it dims the
            content above while the sheet stays on top and interactive. */}
        {succeeded ? (
          <FadeInView style={styles.scrim} toOpacity={0.72} />
        ) : null}

        {succeeded ? (
          <RiseInView accessibilityViewIsModal>
            <Card>
              <SuccessView
                actionLabel="Nice one!"
                message={successCopy.message}
                onAction={handleDismissSuccess}
                title={successCopy.title}
              />
            </Card>
          </RiseInView>
        ) : null}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  backdropSlide: {
    flex: 1,
  },
  backdropFlip: {
    flex: 1,
    transform: [{ scaleY: -1 }],
  },
  content: {
    // No horizontal padding here so the card can bleed edge to edge; the top
    // block adds its own padding instead.
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  // `flex` (basis 0) on this and the card area splits the safe content area
  // ~72/28, so the card stays a compact bottom sheet with little idle space.
  // Expressed as flex rather than a percentage or a window measurement, so it
  // stays correct on any inset without reintroducing viewport-height math.
  top: {
    flex: 72,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.xs,
  },
  cardArea: {
    flex: 28,
  },
  authCard: {
    flex: 1,
    // Match Privy's compact 16-point inline gutters while retaining the shared
    // Card's single outer surface and square bottom edge. A faint violet wash
    // of the brand accent keeps the light sheet from reading as plain white.
    backgroundColor: '#FCFBFF',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  compactTop: {
    paddingHorizontal: spacing.lg,
  },
  topBar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
  },
  brand: {
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  wordmark: {
    ...typography.wordmark,
    marginTop: spacing.md,
    color: colors.textPrimary,
    textAlign: 'center',
    // Offset the trailing letter-spacing so the tracked word stays centred.
    paddingLeft: typography.wordmark.letterSpacing,
    textShadowColor: colors.glassTextShadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 12,
  },
  compactWordmark: {
    fontSize: 40,
    lineHeight: 46,
  },
  // Absolute within the inset content: dims the screen above the sheet without
  // reaching past the safe area. Final translucency comes from the fade's
  // toOpacity, not a static value here.
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.scrim,
  },
});
