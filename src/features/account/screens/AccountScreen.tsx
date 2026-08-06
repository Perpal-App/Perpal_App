import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { PrivateFundingPanel } from '@/features/account/components/PrivateFundingPanel';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
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
            Account
          </Text>
          <Text style={styles.subtitle}>Public identity and private trading</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.walletPanel}>
            <Text accessibilityRole="header" style={styles.walletTitle}>
              Privy wallet
            </Text>
            <Text style={styles.walletStatus}>
              Fund this public wallet before adding private trading collateral.
            </Text>
            <StatusRow
              label="Status"
              value={walletProvisioningLabel(walletProvisioning.status)}
            />
            <StatusRow label="Role" value="Public wallet M" />
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

          <PrivateFundingPanel
            provider={preferences.selectedPerpsProvider}
            tradingReady={tradingSession.status === 'ready'}
          />

          <View style={styles.walletPanel}>
            <Text accessibilityRole="header" style={styles.walletTitle}>
              Private trading
            </Text>
            <Text style={styles.walletStatus}>
              {tradingSessionMessage(tradingSession.status)}
            </Text>
            <StatusRow
              label="Status"
              value={tradingSessionLabel(tradingSession.status)}
            />
            <StatusRow label="Role" value="Private trading wallet T" />
            <StatusRow label="Storage" value="Android secure storage" />
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
                  Perpal will not replace either identity until the old wallet,
                  both providers, and pending Umbra operations are verified empty.
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
            ) : null}
          </View>

          <View style={styles.walletPanel}>
            <Text accessibilityRole="header" style={styles.walletTitle}>
              Trading route
            </Text>
            <Text style={styles.walletStatus}>
              Markets stay public. Funding enters T through Umbra before the
              selected provider receives collateral. Provider accounts are
              internal and are not separate wallets.
            </Text>
            <StatusRow
              label="Provider"
              value={
                preferences.selectedPerpsProvider === 'flash'
                  ? 'Flash Trade v2'
                  : 'Velocity'
              }
            />
            <StatusRow label="Network" value="Solana mainnet" />
            <StatusRow label="Market access" value="Public" />
            <StatusRow label="Trade signing" value="Confirm each transaction" />
          </View>
        </View>

        <View style={styles.footer}>
          {error ? (
            <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
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

function walletProvisioningLabel(
  status: ReturnType<typeof useWalletProvisioning>['status'],
): string {
  switch (status) {
    case 'unauthenticated': return 'Signed out';
    case 'provisioning': return 'Creating or restoring';
    case 'ready': return 'Ready';
    case 'needs-recovery': return 'Recovery required';
    case 'error': return 'Unavailable';
  }
}

function tradingSessionLabel(status: TradingSessionStatus): string {
  switch (status) {
    case 'waiting-for-wallet': return 'Waiting for Privy wallet';
    case 'restoring': return 'Restoring securely';
    case 'inactive': return 'Not activated';
    case 'activating': return 'Activating';
    case 'ready': return 'Ready';
    case 'recovery-required': return 'Recovery review required';
    case 'error': return 'Secure restore failed';
  }
}

function tradingSessionMessage(status: TradingSessionStatus): string {
  switch (status) {
    case 'waiting-for-wallet':
      return 'Privy wallet M must exist before private trading can be activated.';
    case 'restoring':
      return 'Restoring the previously activated private wallet on this device.';
    case 'inactive':
      return 'Activate once to create or recover T. Normal sessions restore it automatically.';
    case 'activating':
      return 'Approve the one-time recovery signature. It moves no funds.';
    case 'ready':
      return 'T is active and restores automatically on this device.';
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
  walletPanel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  walletTitle: { ...typography.heading, color: colors.textPrimary },
  walletStatus: { ...typography.bodyCompact, color: colors.textSecondary },
  notice: { gap: spacing.sm },
  footer: { gap: spacing.sm, paddingTop: spacing.lg },
  error: { ...typography.bodyCompact, color: colors.textSecondary },
});
