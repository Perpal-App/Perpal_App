import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { PrivateFundingPanel } from '@/features/account/components/PrivateFundingPanel';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, spacing, typography } from '@/theme/tokens';
import {
  useTradingSession,
  type TradingSessionStatus,
} from '@/wallet/trading/TradingSessionProvider';

const LOGOUT_CONFIRMATION_TIMEOUT_MS = 8000;

export function AccountScreen() {
  const auth = usePrivyAuth();
  const walletProvisioning = useWalletProvisioning();
  const tradingSession = useTradingSession();
  const preferences = useAppPreferences();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutRequested, setLogoutRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            Wallet
          </Text>
          <Text style={styles.subtitle}>Fund and manage private trading</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.walletTitle}>
              Public wallet
            </Text>
            {walletProvisioning.embeddedWalletAddress ? (
              <StatusRow
                label="Address"
                selectable
                value={walletProvisioning.embeddedWalletAddress}
              />
            ) : (
              <Text accessibilityLiveRegion="polite" style={styles.walletStatus}>
                {walletProvisioningLabel(walletProvisioning.status)}
              </Text>
            )}
            {walletProvisioning.status === 'error' ? (
              <Text accessibilityRole="alert" style={styles.error}>
                Your Privy wallet could not be restored. Confirm you used the
                same login, then retry.
              </Text>
            ) : null}
            {walletProvisioning.status === 'error' ||
            walletProvisioning.status === 'needs-recovery' ? (
              <Button
                label={walletProvisioning.status === 'needs-recovery'
                  ? 'Retry wallet restore'
                  : 'Retry Privy wallet'}
                loading={walletProvisioning.isProvisioning}
                onPress={() => void walletProvisioning.retry()}
                variant="secondary"
              />
            ) : null}
          </View>

          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.walletTitle}>
              Private trading
            </Text>
            <Text style={styles.walletStatus}>
              {tradingSessionMessage(tradingSession.status)}
            </Text>
            {tradingSession.address ? (
              <StatusRow label="Address" selectable value={tradingSession.address} />
            ) : null}
            {tradingSession.recovery ? (
              <View style={styles.notice}>
                <StatusRow
                  label="Recorded wallet"
                  selectable
                  value={tradingSession.recovery.recorded.address}
                />
                <StatusRow
                  label="Recovered wallet"
                  selectable
                  value={tradingSession.recovery.derived.address}
                />
                <Text accessibilityRole="alert" style={styles.walletStatus}>
                  Trading remains blocked until this identity mismatch is
                  resolved safely.
                </Text>
              </View>
            ) : null}
            {tradingSession.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {tradingSession.error}
              </Text>
            ) : null}
            {tradingSession.status === 'inactive' ? (
              <Button
                label="Activate private trading"
                onPress={() => void tradingSession.activate()}
              />
            ) : tradingSession.status === 'activating' ? (
              <Button
                label="Activating private trading"
                loading
                onPress={() => undefined}
              />
            ) : tradingSession.status === 'error' ? (
              <Button
                label="Retry secure restore"
                onPress={tradingSession.retryRestore}
                variant="secondary"
              />
            ) : tradingSession.status === 'rotating' ? (
              <Button label="Verifying zero balances" loading onPress={() => undefined} />
            ) : null}
          </View>

          {tradingSession.status === 'ready' ? (
            <PrivateFundingPanel
              provider={preferences.selectedPerpsProvider}
              tradingReady
            />
          ) : null}
        </View>

        <View style={styles.footer}>
          {error ? (
            <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          {tradingSession.status === 'ready' ? (
            <Button
              label="Rotate private wallet"
              onPress={() => Alert.alert(
                'Rotate private wallet?',
                'Rotation is allowed only after every balance, position, order, and pending private transfer is empty.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Verify and rotate', onPress: () => void tradingSession.rotate() },
                ],
              )}
              variant="secondary"
            />
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

function walletProvisioningLabel(
  status: ReturnType<typeof useWalletProvisioning>['status'],
): string {
  switch (status) {
    case 'unauthenticated': return 'Signed out';
    case 'provisioning': return 'Creating or restoring';
    case 'ready': return 'Ready';
    case 'needs-recovery': return 'Restoring on this device';
    case 'error': return 'Unavailable';
  }
}

function tradingSessionMessage(status: TradingSessionStatus): string {
  switch (status) {
    case 'waiting-for-wallet':
      return 'Waiting for your public wallet.';
    case 'restoring':
      return 'Restoring your private wallet securely.';
    case 'inactive':
      return 'Activate once. It restores automatically on this device afterward.';
    case 'activating':
      return 'Approve the one-time setup signature. It moves no funds.';
    case 'rotating':
      return 'Checking balances, positions, orders, and pending private transfers.';
    case 'ready':
      return 'Ready. Add funds below, then trade from Markets.';
    case 'recovery-required':
      return 'The recovered identity differs from the recorded wallet, so trading is blocked.';
    case 'error':
      return 'The saved private trading wallet could not be verified.';
  }
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
  header: { paddingVertical: spacing.sm },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: {
    ...typography.bodyCompact,
    marginTop: spacing.xxs,
    color: colors.textSecondary,
  },
  body: { flexGrow: 1, justifyContent: 'center', gap: spacing.lg },
  section: {
    gap: spacing.md,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  walletTitle: { ...typography.heading, color: colors.textPrimary },
  walletStatus: { ...typography.bodyCompact, color: colors.textSecondary },
  notice: { gap: spacing.sm },
  footer: { gap: spacing.sm, paddingTop: spacing.lg },
  error: { ...typography.bodyCompact, color: colors.textSecondary },
});
