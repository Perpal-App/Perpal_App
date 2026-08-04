import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { colors, layout, spacing, typography } from '@/theme/tokens';

const LOGOUT_CONFIRMATION_TIMEOUT_MS = 8000;

/**
 * Account tab. Settings are not built yet, so the screen is honest about that
 * and offers the one account action that exists today: signing out. The root
 * auth guard reacts to Privy's confirmed session change and removes the entire
 * authenticated route tree, so this screen never performs its own redirect.
 */
export function AccountScreen() {
  const auth = usePrivyAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutRequested, setLogoutRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Privy's logout promise can resolve before consumers observe the new user
  // value. Keep the action pending until the root guard removes this route; if
  // no authoritative unauthenticated state arrives, recover with a useful error.
  useEffect(() => {
    if (!logoutRequested || (auth.isReady && !auth.isAuthenticated)) {
      return;
    }

    const timer = setTimeout(() => {
      setLogoutRequested(false);
      setSigningOut(false);
      setError('Sign out could not be confirmed. Please try again.');
    }, LOGOUT_CONFIRMATION_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [auth.isAuthenticated, auth.isReady, logoutRequested]);

  const handleSignOut = async () => {
    setSigningOut(true);
    setLogoutRequested(false);
    setError(null);

    try {
      await auth.logout();
      setLogoutRequested(true);
    } catch {
      setSigningOut(false);
      setError('Sign out could not be completed. Please try again.');
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
            label="Sign out"
            loading={signingOut}
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
