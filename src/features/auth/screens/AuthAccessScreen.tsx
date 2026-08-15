import { useEffect } from 'react';
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
import { PresenceView } from '@/components/motion/PresenceView';
import { ScaleInView } from '@/components/motion/ScaleInView';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { AuthFlowCard } from '@/features/auth/components/AuthFlowCard';
import { OnboardingBackdrop } from '@/features/onboarding/components/OnboardingBackdrop';
import { useAuthHandoff } from '@/navigation/authHandoff';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, motion, spacing, typography } from '@/theme/tokens';

const successCopy = {
  title: 'You’re in',
  message: "You're logged in and ready to trade.",
} as const;

/** Vertical travel for the success sheet's slide in / slide out, in px. */
const SUCCESS_SHEET_TRAVEL = 48;

/**
 * The logo and text begin as the backdrop is settling, then cascade a step
 * apart. Kept short so the reveal never feels like a wait.
 */
const revealDelay = (step: number) =>
  motion.backdropSlide.contentDelay + step * motion.rise.stagger;

/**
 * Account-access screen. Privy identity and wallet wiring belongs to the
 * integration boundary and is intentionally not invoked from this screen.
 * AuthNavigationGate replaces this route as soon as Privy confirms a session,
 * so successful login never depends on a local button or stack mutation.
 *
 * On entry the landing gradient (flipped so the bloom sits at the top) slides up
 * fast-then-smooth. The brand mark rides near the top over it, and the access
 * actions live in a bottom-sheet card.
 */
export function AuthAccessScreen() {
  const { isAwaitingEntry, confirmEntry } = useAuthHandoff();
  const { showOnboardingIntro } = useAppPreferences();
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

  const handleBack = () => {
    showOnboardingIntro();
  };

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
            {/* Hidden during the success handoff: going back after signing in
                is not a valid action. */}
            {isAwaitingEntry ? null : (
              <IconButton
                accessibilityHint="Returns to the Perpal introduction"
                accessibilityLabel="Go back"
                onPress={handleBack}
                size={48}
              >
                <DirectionIcon direction="left" size={22} />
              </IconButton>
            )}
          </FadeInView>

          {/* The brand settles from a larger scale as the screen pushes in, so
              it reads as the onboarding hero shrinking into this header — a
              shared-element-style handoff done with composited transforms
              rather than the experimental native shared-element API. */}
          <View style={styles.brand}>
            <ScaleInView delay={revealDelay(0)} fromScale={1.22}>
              <BrandMark size={markSize} />
            </ScaleInView>

            <ScaleInView
              delay={revealDelay(1)}
              fromScale={1.12}
              offsetY={motion.rise.offsetY}
            >
              <Text style={[styles.wordmark, compact && styles.compactWordmark]}>
                Perpal
              </Text>
            </ScaleInView>
          </View>
        </View>

        {isAwaitingEntry ? null : (
          <View style={styles.cardArea}>
            <Card style={styles.authCard}>
              <AuthFlowCard />
            </Card>
          </View>
        )}

        {/* Scrim and sheet stay inside AppScreen's content, so the safe-area
            inset bounds them. Both are absolute siblings: the scrim dims the
            content above while the sheet sits flush at the inset bottom. As
            absolute layers they are decoupled from the auth card's flow, so the
            auth card can reclaim its space without shifting the sheet. */}
        <PresenceView
          duration={motion.fade.duration}
          style={styles.scrim}
          toOpacity={0.72}
          visible={isAwaitingEntry}
        />

        <PresenceView
          accessibilityViewIsModal
          offsetY={SUCCESS_SHEET_TRAVEL}
          style={styles.successSheet}
          visible={isAwaitingEntry}
        >
          <Card>
            <SuccessView
              actionLabel="Enter Perpal"
              message={successCopy.message}
              onAction={confirmEntry}
              title={successCopy.title}
            />
          </Card>
        </PresenceView>
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
    // Patrick Hand needs 1.36x its size to keep the "p" descender intact.
    lineHeight: 55,
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
  // Bottom-anchored overlay for the success sheet. Absolute (not in flow) so its
  // exit animation is independent of the auth card reclaiming its layout slot.
  successSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
