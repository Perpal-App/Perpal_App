import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { AuthHandoffProvider } from '@/navigation/authHandoff';
import { globalScreenOptions } from '@/navigation/screenOptions';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, spacing, typography } from '@/theme/tokens';

type ResolvedSession = 'authenticated' | 'unauthenticated';
type RootRouteName = '(auth)' | '(tabs)' | 'index';

/**
 * Owns the route tree for both authenticated and unauthenticated sessions.
 *
 * A non-null Privy user is immediately authoritative. A null user becomes
 * authoritative only after Privy is ready, preventing startup from treating an
 * unresolved persisted session as logged out. The last resolved session is kept
 * while readiness is transient (for example during an OAuth browser handoff).
 *
 * The Stack is keyed by the resolved session, so a restored `/access` history
 * cannot survive authentication: the authenticated tree remounts at `(tabs)`,
 * whose initial route is pinned to `home`.
 */
export function AuthNavigationGate() {
  const { initializationError, isAuthenticated, isReady } = usePrivyAuth();
  const preferences = useAppPreferences();
  const currentSession: ResolvedSession | null = isAuthenticated
    ? 'authenticated'
    : isReady && initializationError === null
      ? 'unauthenticated'
      : null;
  const [lastResolvedSession, setLastResolvedSession] =
    useState<ResolvedSession | null>(currentSession);
  // Set only for a sign-in that happens while the app is running, never for a
  // restored session, so a restart still goes straight to the tab shell.
  const [pendingEntry, setPendingEntry] = useState(false);

  useEffect(() => {
    if (currentSession === null || currentSession === lastResolvedSession) {
      return;
    }

    setPendingEntry(
      lastResolvedSession === 'unauthenticated' &&
        currentSession === 'authenticated',
    );
    setLastResolvedSession(currentSession);
  }, [currentSession, lastResolvedSession]);

  const confirmEntry = useCallback(() => setPendingEntry(false), []);
  const session = currentSession ?? lastResolvedSession;
  // While the success confirmation is pending, the auth route stays mounted so
  // the card can play. Tabs remain unmounted until the user acknowledges it.
  const isAwaitingEntry = pendingEntry && session === 'authenticated';
  const handoff = useMemo(
    () => ({ isAwaitingEntry, confirmEntry }),
    [confirmEntry, isAwaitingEntry],
  );

  if (initializationError !== null) {
    return <SessionResolutionState hasError />;
  }

  if (
    session === null ||
    (session === 'unauthenticated' && !preferences.isReady)
  ) {
    return <SessionResolutionState />;
  }

  const isAuthenticatedSession = session === 'authenticated' && !isAwaitingEntry;
  const initialRouteName: RootRouteName = isAuthenticatedSession
    ? '(tabs)'
    : preferences.hasSeenOnboardingIntro
      ? '(auth)'
      : 'index';

  return (
    <AuthHandoffProvider value={handoff}>
      <Stack
        key={isAuthenticatedSession ? 'authenticated' : 'unauthenticated'}
        initialRouteName={initialRouteName}
        screenOptions={globalScreenOptions}
      >
        {/* Dropping `index` during the handoff also prunes it from history, so
            back cannot return to onboarding while already signed in. */}
        <Stack.Protected guard={!isAuthenticatedSession && !isAwaitingEntry}>
          <Stack.Screen name="index" />
        </Stack.Protected>

        <Stack.Protected guard={!isAuthenticatedSession}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>

        <Stack.Protected guard={isAuthenticatedSession}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="market-chart/[venueRef]" />
        </Stack.Protected>
      </Stack>
    </AuthHandoffProvider>
  );
}

function SessionResolutionState({ hasError = false }: { hasError?: boolean }) {
  if (!hasError) {
    // Deliberately empty. The launch screen is a flat fill of this same background,
    // so an empty screen here is indistinguishable from the one the OS was already
    // showing — restoring a session looks like the app still starting up, which is
    // what it is. A spinner would be the only thing announcing a wait that is
    // normally over before anyone could read it, and it would appear and vanish for
    // a few frames on every cold start.
    return (
      <AppScreen scroll={false}>
        <View style={styles.restoring} />
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <View accessibilityRole="alert" style={styles.state}>
        <Text style={styles.title}>Session unavailable</Text>
        <Text style={styles.message}>
          We couldn’t verify your saved session. Check your connection, then
          close and reopen Perpal.
        </Text>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  // Holds the screen's height so the background fills it rather than collapsing.
  restoring: { flexGrow: 1 },
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
