import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { colors, layout, spacing, typography } from '@/theme/tokens';

/**
 * Account tab. Settings are not built yet, so the screen is honest about that
 * and offers the one account action that exists today: signing out. The root
 * auth guard reacts to Privy's confirmed session change and removes the entire
 * authenticated route tree, so this screen never performs its own redirect.
 */
export function AccountScreen() {
  const auth = usePrivyAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setSigningOut(true);
    setError(null);

    try {
      await auth.logout();
    } catch {
      setError('Sign out could not be completed. Please try again.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <AppScreen>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Account
          </Text>
          <Text style={styles.subtitle}>Manage your Perpal session</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.note}>More account settings are coming soon.</Text>
        </View>

        <View style={styles.footer}>
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={styles.error}
            >
              {error}
            </Text>
          ) : null}
          <Button
            disabled={signingOut}
            label={signingOut ? 'Signing out…' : 'Sign out'}
            onPress={() => void handleSignOut()}
            variant="secondary"
          />
        </View>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyCompact,
    marginTop: spacing.xxs,
    color: colors.textSecondary,
  },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  note: {
    ...typography.bodyCompact,
    color: colors.textMuted,
    textAlign: 'center',
  },
  footer: {
    gap: spacing.sm,
  },
  error: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
