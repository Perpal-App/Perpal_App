import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { BuildTargetBadge } from '@/features/diagnostics/components/BuildTargetBadge';
import { useTradingSession } from '@/integrations/perps/drift/trading-session-provider';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

const LOGOUT_CONFIRMATION_TIMEOUT_MS = 8000;

/**
 * Account tab. Settings are not built yet, so the screen is honest about that
 * and offers the one account action that exists today: signing out. The root
 * auth guard reacts to Privy's confirmed session change and removes the entire
 * authenticated route tree, so this screen never performs its own redirect.
 */
export function AccountScreen() {
  const auth = usePrivyAuth();
  const walletProvisioning = useWalletProvisioning();
  const tradingSession = useTradingSession();
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
      await tradingSession.lock();
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
          <BuildTargetBadge />
          <View style={styles.walletPanel}>
            <Text accessibilityRole="header" style={styles.walletTitle}>
              Privy embedded wallet
            </Text>
            <Text selectable style={styles.walletStatus}>
              {walletProvisioningMessage(walletProvisioning.status)}
            </Text>
            <StatusRow
              label="Status"
              value={walletProvisioningLabel(walletProvisioning.status)}
            />
            <StatusRow
              label="Purpose"
              value="Identity and trading-wallet derivation"
            />
            {walletProvisioning.embeddedWalletAddress ? (
              <StatusRow
                label="Address"
                selectable
                value={walletProvisioning.embeddedWalletAddress}
              />
            ) : null}
            {walletProvisioning.status === 'error' ? (
              <Button
                label="Retry wallet creation"
                loading={walletProvisioning.isProvisioning}
                onPress={() => void walletProvisioning.retry()}
                variant="secondary"
              />
            ) : null}
          </View>
          <View style={styles.walletPanel}>
            <Text accessibilityRole="header" style={styles.walletTitle}>
              Trading wallet
            </Text>
            <Text selectable style={styles.walletStatus}>
              {tradingSessionMessage(tradingSession.status)}
            </Text>
            <StatusRow
              label="Status"
              value={tradingSessionLabel(tradingSession.status)}
            />
            <StatusRow label="Network" value="Drift devnet" />
            {tradingSession.tradingWalletAddress ? (
              <StatusRow
                label="Address"
                selectable
                value={tradingSession.tradingWalletAddress}
              />
            ) : null}
            <Button
              disabled={
                tradingSession.status === 'unavailable' ||
                tradingSession.status === 'identity-mismatch'
              }
              label={
                tradingSession.status === 'ready'
                  ? 'Lock trading wallet'
                  : 'Unlock trading wallet'
              }
              loading={tradingSession.status === 'unlocking'}
              onPress={() =>
                void (tradingSession.status === 'ready'
                  ? tradingSession.lock()
                  : tradingSession.unlock())
              }
              variant="secondary"
            />
          </View>
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
    gap: spacing.lg,
  },
  walletPanel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  walletTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  walletStatus: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
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

function tradingSessionMessage(
  status: ReturnType<typeof useTradingSession>['status'],
): string {
  switch (status) {
    case 'unavailable':
      return 'Waiting for your embedded Solana wallet.';
    case 'locked':
      return 'Unlock with one explicit message signature to connect Drift devnet.';
    case 'unlocking':
      return 'Deriving the local trading wallet and checking Drift devnet…';
    case 'ready':
      return 'Connected to Drift devnet. The signing key is held in memory only.';
    case 'identity-mismatch':
      return 'The derived wallet does not match this account’s recorded identity. Trading is blocked.';
    case 'error':
      return 'The trading wallet or Drift devnet could not be verified. Try again.';
  }
}

function tradingSessionLabel(
  status: ReturnType<typeof useTradingSession>['status'],
): string {
  switch (status) {
    case 'unavailable':
      return 'Waiting for Privy wallet';
    case 'locked':
      return 'Locked';
    case 'unlocking':
      return 'Connecting';
    case 'ready':
      return 'Ready';
    case 'identity-mismatch':
      return 'Identity mismatch';
    case 'error':
      return 'Connection failed';
  }
}

function walletProvisioningLabel(
  status: ReturnType<typeof useWalletProvisioning>['status'],
): string {
  switch (status) {
    case 'unauthenticated':
      return 'Signed out';
    case 'provisioning':
      return 'Creating or restoring';
    case 'ready':
      return 'Ready';
    case 'needs-recovery':
      return 'Recovery required';
    case 'error':
      return 'Unavailable';
  }
}

function walletProvisioningMessage(
  status: ReturnType<typeof useWalletProvisioning>['status'],
): string {
  switch (status) {
    case 'unauthenticated':
      return 'Sign in before creating the embedded Solana wallet.';
    case 'provisioning':
      return 'Privy is creating or restoring the embedded Solana wallet.';
    case 'ready':
      return 'Available. It signs one explicit derivation message; trades use the separate wallet below.';
    case 'needs-recovery':
      return 'Privy requires wallet recovery before trading can continue.';
    case 'error':
      return 'Creation failed. Confirm embedded Solana wallets are enabled in Privy, then retry.';
  }
}
