import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { globalScreenOptions } from '@/navigation/screenOptions';
import { colors, layout, spacing, typography } from '@/theme/tokens';

type ResolvedSession = 'authenticated' | 'unauthenticated';

/**
 * Owns the route tree for both authenticated and unauthenticated sessions.
 *
 * Privy's `isReady` is authoritative for session restoration. Until it resolves
 * for the first time, no route is mounted, which prevents onboarding from
 * flashing while a persisted user is restored. After that first resolution we
 * retain the last confirmed session during transient not-ready periods (for
 * example, an OAuth browser handoff) so the active flow is not unmounted.
 *
 * Protected screens also remove invalid history entries when their guard turns
 * false. Login, logout, passive expiry, and deep links therefore all converge on
 * the same behavior without screen-level redirect races.
 */
export function AuthNavigationGate() {
  const { initializationError, isAuthenticated, isReady } = usePrivyAuth();
  const currentSession: ResolvedSession | null =
    isReady && initializationError === null
      ? isAuthenticated
        ? 'authenticated'
        : 'unauthenticated'
      : null;
  const [lastResolvedSession, setLastResolvedSession] =
    useState<ResolvedSession | null>(currentSession);

  useEffect(() => {
    if (currentSession !== null) {
      setLastResolvedSession(currentSession);
    }
  }, [currentSession]);

  if (initializationError !== null) {
    return <SessionResolutionState hasError />;
  }

  const session = currentSession ?? lastResolvedSession;

  if (session === null) {
    return <SessionResolutionState />;
  }

  const isAuthenticatedSession = session === 'authenticated';

  return (
    <Stack screenOptions={globalScreenOptions}>
      <Stack.Protected guard={!isAuthenticatedSession}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      <Stack.Protected guard={isAuthenticatedSession}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
    </Stack>
  );
}

function SessionResolutionState({ hasError = false }: { hasError?: boolean }) {
  return (
    <AppScreen>
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole={hasError ? 'alert' : undefined}
        style={styles.state}
      >
        {hasError ? null : (
          <ActivityIndicator
            accessibilityLabel="Restoring secure session"
            color={colors.accent}
          />
        )}
        <Text style={styles.title}>
          {hasError ? 'Session unavailable' : 'Restoring your session…'}
        </Text>
        {hasError ? (
          <Text style={styles.message}>
            We couldn’t verify your saved session. Check your connection, then
            close and reopen Perpal.
          </Text>
        ) : null}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  state: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: layout.screenPadding,
    gap: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  message: {
    ...typography.bodyCompact,
    maxWidth: 360,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
