import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { DirectionIcon } from '@/assets/svg/DirectionIcon';
import { AppScreen } from '@/components/layout/AppScreen';
import { StepIndicator } from '@/components/progress/StepIndicator';
import { IconButton } from '@/components/ui/IconButton';
import { OnboardingBackdrop } from '@/features/onboarding/components/OnboardingBackdrop';
import { SparkMark } from '@/assets/svg/SparkMark';
import { colors, layout, spacing, typography } from '@/theme/tokens';

export function OnboardingLandingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width < 360;

  const handleContinue = () => {
    router.push('/access');
  };

  return (
    <AppScreen background={<OnboardingBackdrop />} contentContainerStyle={styles.scrollContent}>
      <View style={[styles.content, compact && styles.compactContent]}>
        <View style={styles.hero}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.spark}
          >
            <SparkMark size={compact ? 180 : 200} />
          </View>

          <Text accessibilityRole="header" style={[styles.title, compact && styles.compactTitle]}>
            Private trading.{`\n`}Your control.
          </Text>

          <Text style={styles.description}>
            Your trading wallet is unlinked from your identity. Positions stay visible
            on-chain, and your signing key never leaves this device.
          </Text>

          <View style={styles.steps}>
            <StepIndicator activeIndex={0} total={3} />
          </View>
        </View>

        <View style={styles.footer}>
          <IconButton
            accessibilityHint="Opens sign in and account creation options"
            accessibilityLabel="Continue to account access"
            onPress={handleContinue}
            size={compact ? 68 : 76}
            tone="dark"
          >
            <DirectionIcon color={colors.textPrimary} direction="right" size={26} />
          </IconButton>
        </View>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    minHeight: '100%',
  },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    minHeight: 660,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  compactContent: {
    paddingHorizontal: spacing.lg,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    marginTop: spacing.lg,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  steps: {
    marginTop: spacing.xxl,
  },
  footer: {
    alignItems: 'center',
    paddingTop: spacing.xxxl,
  },
});
