import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BrandMark } from '@/components/brand/BrandMark';
import { DirectionIcon } from '@/assets/svg/DirectionIcon';
import { AppScreen } from '@/components/layout/AppScreen';
import { StepIndicator } from '@/components/progress/StepIndicator';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

type AccessChoice = 'create' | 'sign-in' | null;

const selectionMessage: Record<Exclude<AccessChoice, null>, string> = {
  create: 'Create account selected.',
  'sign-in': 'Sign in selected.',
};

/**
 * Account-access choice only. Privy identity and wallet wiring belongs to the
 * integration boundary and is intentionally not invoked from this screen.
 */
export function AuthAccessScreen() {
  const router = useRouter();
  const [choice, setChoice] = useState<AccessChoice>(null);

  const handleBack = () => {
    router.back();
  };

  return (
    <AppScreen contentContainerStyle={styles.scrollContent}>
      <View style={styles.content}>
        <View style={styles.topBar}>
          <IconButton
            accessibilityHint="Returns to the Perpal introduction"
            accessibilityLabel="Go back"
            onPress={handleBack}
            size={48}
          >
            <DirectionIcon direction="left" size={22} />
          </IconButton>
          <StepIndicator activeIndex={1} total={2} />
          <View accessibilityElementsHidden style={styles.topBarSpacer} />
        </View>

        <View style={styles.intro}>
          <BrandMark size={58} />
          <Text style={styles.eyebrow}>ACCOUNT ACCESS</Text>
          <Text accessibilityRole="header" style={styles.title}>
            Sign in or create an account
          </Text>
          <Text style={styles.description}>
            Your identity session and trading key are separate. Perpal never receives your
            private key or signs a trade for you.
          </Text>
        </View>

        <View accessibilityLabel="Account access options" style={styles.panel}>
          <Text style={styles.panelTitle}>Choose how to continue</Text>
          <View style={styles.actions}>
            <Button label="Create account" onPress={() => setChoice('create')} />
            <Button
              label="Sign in"
              onPress={() => setChoice('sign-in')}
              variant="secondary"
            />
          </View>
          <Text accessibilityLiveRegion="polite" style={styles.selectionStatus}>
            {choice ? selectionMessage[choice] : 'No option selected.'}
          </Text>
        </View>

        <View style={styles.safetyNote}>
          <View style={styles.safetyDot} />
          <Text style={styles.safetyText}>
            Every trade still requires your review and explicit confirmation.
          </Text>
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
    minHeight: 700,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.lg,
  },
  topBar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarSpacer: {
    width: 48,
    height: 48,
  },
  intro: {
    alignItems: 'center',
    paddingTop: spacing.jumbo,
    paddingBottom: spacing.xxxl,
  },
  eyebrow: {
    ...typography.eyebrow,
    marginTop: spacing.xl,
    color: colors.accentSoft,
    textAlign: 'center',
  },
  title: {
    ...typography.title,
    maxWidth: 420,
    marginTop: spacing.md,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    maxWidth: 420,
    marginTop: spacing.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  panelTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  selectionStatus: {
    ...typography.body,
    minHeight: 24,
    marginTop: spacing.md,
    color: colors.textMuted,
    textAlign: 'center',
  },
  safetyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: 'auto',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xl,
  },
  safetyDot: {
    width: 7,
    height: 7,
    marginTop: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  safetyText: {
    ...typography.body,
    flex: 1,
    color: colors.textSecondary,
  },
});
