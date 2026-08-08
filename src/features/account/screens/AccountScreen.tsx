import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { amountFromBaseUnits, formatAmount } from '@/domain/money/amount';
import { PrivateFundingPanel } from '@/features/account/components/PrivateFundingPanel';
import { useWalletBalances } from '@/features/account/hooks/useWalletBalances';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { usePrivateFunding } from '@/integrations/umbra/PrivateFundingProvider';
import type { PrivateFundingRecord } from '@/integrations/umbra/umbraSecureStorage';
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
  const funding = usePrivateFunding();
  const walletBalances = useWalletBalances({
    privateAddress: tradingSession.address,
    publicAddress: walletProvisioning.embeddedWalletAddress,
    signer: tradingSession.signer,
  });
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
              Public wallet (M)
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
              Private trading wallet (T)
            </Text>
            <Text style={styles.walletStatus}>
              {tradingSessionMessage(tradingSession.status)}
            </Text>
            {tradingSession.address ? (
              <StatusRow label="T address" selectable value={tradingSession.address} />
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
            <View style={styles.section}>
              <Text accessibilityRole="header" style={styles.walletTitle}>
                Funds location
              </Text>
              <StatusRow
                label="Private funding"
                value={privateFundingLocation(funding.record)}
              />
              {walletBalances.balances ? (
                <>
                  <StatusRow
                    label="Public M"
                    value={stablecoinBalances(walletBalances.balances.publicWallet)}
                  />
                  <StatusRow
                    label="M fee balance"
                    value={solBalance(walletBalances.balances.publicWallet.solLamports)}
                  />
                  <StatusRow
                    label="Private T"
                    value={stablecoinBalances(walletBalances.balances.privateWallet)}
                  />
                  <StatusRow
                    label="T fee balance"
                    value={solBalance(walletBalances.balances.privateWallet.solLamports)}
                  />
                </>
              ) : (
                <Text accessibilityLiveRegion="polite" style={styles.walletStatus}>
                  {walletBalances.status === 'error'
                    ? 'Balances unavailable. Retrying.'
                    : 'Loading wallet balances.'}
                </Text>
              )}
              <Text style={styles.walletStatus}>
                Venue collateral appears in Portfolio only while allocated to a trade.
              </Text>
            </View>
          ) : null}

          {tradingSession.status === 'ready' ? (
            <PrivateFundingPanel tradingReady />
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
      return 'Ready. Private funds stay in T until a trade allocates collateral.';
    case 'recovery-required':
      return 'The recovered identity differs from the recorded wallet, so trading is blocked.';
    case 'error':
      return 'The saved private trading wallet could not be verified.';
  }
}

function privateFundingLocation(record: PrivateFundingRecord | null): string {
  if (record === null) return 'No private transfer';
  if (record.providerDepositSignature !== null) {
    return 'Legacy provider allocation — manual recovery required';
  }
  if (record.claimSignature !== null) return 'Private wallet T';
  if (record.depositSignature !== null) return 'Umbra pool';
  return 'Public wallet M';
}

function stablecoinBalances(balance: {
  readonly usdcBaseUnits: bigint;
  readonly usdtBaseUnits: bigint;
}): string {
  return `${formatAmount(amountFromBaseUnits(balance.usdcBaseUnits, 6))} USDC · ${formatAmount(amountFromBaseUnits(balance.usdtBaseUnits, 6))} USDT`;
}

function solBalance(lamports: bigint): string {
  return `${formatAmount(amountFromBaseUnits(lamports, 9))} SOL`;
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
