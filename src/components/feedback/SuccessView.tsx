import LottieView from 'lottie-react-native';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Button } from '@/components/ui/Button';
import { colors, spacing, typography } from '@/theme/tokens';

// dotLottie brand success animation (registered as a Metro asset in
// metro.config.js). It is already in the brand purple, so no tint is applied.
// Expo's eslint asset-require allowlist covers images/fonts but not `.lottie`,
// so this one documented asset require is allowed explicitly.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- dotLottie asset load
const successAnimation = require('../../../assets/lotties/success-purple.lottie') as ComponentProps<
  typeof LottieView
>['source'];

/**
 * The dotLottie canvas is 600x600 with the badge sitting in the middle, so most
 * of it is transparent padding. Sizing the layout box up to enlarge the badge
 * therefore costs far more vertical space than it adds visible artwork — that is
 * what pushed the action button off screen.
 *
 * Instead the box stays compact and the view is scaled. A transform does not
 * affect layout, and visible size tracks `box * scale`, so keeping that product
 * at `132 * 3` renders the badge at 3x its original size for any amount of
 * padding, while the sheet stays short enough to keep the button in view.
 */
const ANIMATION_BOX = 170;
const ANIMATION_SCALE = (132 * 3) / ANIMATION_BOX;

type SuccessViewProps = {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction: () => void;
};

/**
 * Success confirmation: the brand Lottie plays once above a short title,
 * message, and a single action. Sized to drop into a bottom-sheet card.
 *
 * Under reduce motion the animation is pinned to its final frame (the completed
 * check) rather than playing, so the state is still conveyed without movement.
 */
export function SuccessView({
  title = 'Success!',
  message,
  actionLabel = 'Continue',
  onAction,
}: SuccessViewProps) {
  const reduceMotion = useReducedMotion();

  return (
    <View style={styles.container}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      >
        <LottieView
          autoPlay={!reduceMotion}
          loop={false}
          source={successAnimation}
          style={styles.animation}
          // Pin to the last frame instead of animating when motion is reduced.
          {...(reduceMotion ? { progress: 1 } : null)}
        />
      </View>

      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={styles.action}>
        <Button label={actionLabel} onPress={onAction} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  animation: {
    width: ANIMATION_BOX,
    height: ANIMATION_BOX,
    transform: [{ scale: ANIMATION_SCALE }],
  },
  title: {
    ...typography.heading,
    marginTop: spacing.sm,
    color: colors.onLight,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    ...typography.body,
    marginTop: spacing.xs,
    // The palette has no dedicated light-surface secondary ink; dropping the
    // near-black `onLight` to 0.6 keeps it above the AA contrast floor on the
    // light card while still reading as secondary. No new colour token added.
    color: colors.onLight,
    opacity: 0.6,
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
});
