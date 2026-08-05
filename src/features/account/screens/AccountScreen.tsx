import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
import {
  useTradingSession,
  type TradingSessionStatus,
} from '@/wallet/trading/TradingSessionProvider';

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
  const preferences = useAppPreferences();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutRequested, setLogoutRequested] = useState(false);
  const [replacementConfirmed, setReplacementConfirmed] = useState(false);
  const [replacingIdentity, setReplacingIdentity] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReplacementConfirmed(false);
    setReplacingIdentity(false);
  }, [
    tradingSession.recovery?.derived.address,
    tradingSession.recovery?.recorded.address,
  ]);

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

  const confirmTradingWalletReplacement = () => {
    const recovery = tradingSession.recovery;

    if (recovery === null || !replacementConfirmed || replacingIdentity) {
      return;
    }

    Alert.alert(
      'Replace recorded trading wallet?',
      'Continue only if the previous trading wallet has no funds or positions. This changes Perpal’s recorded wallet identity; it does not move or recover funds.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => {
            setReplacingIdentity(true);
            setError(null);
            void tradingSession
              .replaceRecordedIdentity()
              .catch(() => {
                setError('The recorded trading wallet could not be replaced.');
              })
              .finally(() => {
                setReplacingIdentity(false);
              });
          },
        },
      ],
    );
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
              value="Identity and confirmed trade authorization"
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
            <StatusRow label="Storage" value="Key held in memory only" />
            {tradingSession.address ? (
              <StatusRow
                label="Address"
                selectable
                value={tradingSession.address}
              />
            ) : null}
            {tradingSession.recovery ? (
              <>
                <StatusRow
                  label={`Recorded v${tradingSession.recovery.recorded.version}`}
                  selectable
                  value={tradingSession.recovery.recorded.address}
                />
                <StatusRow
                  label={`Derived v${tradingSession.recovery.derived.version}`}
                  selectable
                  value={tradingSession.recovery.derived.address}
                />
                <View style={styles.replacementConfirmation}>
                  <Switch
                    accessibilityHint="Required before replacing the recorded trading wallet"
                    accessibilityLabel="I verified the recorded wallet is empty"
                    onValueChange={setReplacementConfirmed}
                    value={replacementConfirmed}
                  />
                  <Text style={styles.replacementConfirmationText}>
                    I verified the recorded wallet has no SOL, tokens, positions,
                    or open orders.
                  </Text>
                </View>
                <Button
                  disabled={!replacementConfirmed || replacingIdentity}
                  label="Review wallet replacement"
                  loading={replacingIdentity}
                  onPress={confirmTradingWalletReplacement}
                  variant="secondary"
                />
              </>
            ) : null}
            {tradingSession.status === 'ready' ? (
              <Button
                label="Lock trading wallet"
                onPress={tradingSession.lock}
                variant="secondary"
              />
            ) : tradingSession.status !== 'waiting-for-wallet' &&
              tradingSession.status !== 'recovery-required' ? (
              <Button
                disabled={tradingSession.status === 'unlocking'}
                label="Unlock trading wallet"
                loading={tradingSession.status === 'unlocking'}
                onPress={() => void tradingSession.unlock()}
                variant="secondary"
              />
            ) : null}
          </View>
          <View style={styles.walletPanel}>
            <Text accessibilityRole="header" style={styles.walletTitle}>
              Trading preference
            </Text>
            <Text selectable style={styles.walletStatus}>
              Markets remain visible without a wallet signature. Change the
              active provider from the Markets tab.
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
  replacementConfirmation: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  replacementConfirmationText: {
    ...typography.bodyCompact,
    flex: 1,
    color: colors.textPrimary,
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
      return 'Available. Market browsing is public; signing is requested only for a confirmed trade.';
    case 'needs-recovery':
      return 'Privy requires wallet recovery before trading can continue.';
    case 'error':
      return 'Creation failed. Confirm embedded Solana wallets are enabled in Privy, then retry.';
  }
}

function tradingSessionLabel(status: TradingSessionStatus): string {
  switch (status) {
    case 'waiting-for-wallet':
      return 'Waiting for Privy wallet';
    case 'locked':
      return 'Locked';
    case 'unlocking':
      return 'Awaiting approval';
    case 'ready':
      return 'Ready';
    case 'recovery-required':
      return 'Recovery required';
    case 'error':
      return 'Unlock failed';
  }
}

function tradingSessionMessage(status: TradingSessionStatus): string {
  switch (status) {
    case 'waiting-for-wallet':
      return 'The embedded Solana wallet must be ready before trading can unlock.';
    case 'locked':
      return 'Unlock with one explicit, non-transaction Privy message signature. No market data requires this.';
    case 'unlocking':
      return 'Approve the derivation message in Privy. It authorizes no transaction or transfer.';
    case 'ready':
      return 'Derived and verified on this device. The signing seed stays in memory and clears on lock or logout.';
    case 'recovery-required':
      return 'The corrected derivation does not match the recorded trading identity. Review both addresses before replacing anything.';
    case 'error':
      return 'The signature or stored identity could not be verified. Retry without changing wallets.';
  }
}
