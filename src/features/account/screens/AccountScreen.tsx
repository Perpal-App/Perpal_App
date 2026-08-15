import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Application from 'expo-application';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { PressableScale } from '@/components/ui/PressableScale';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { TAB_BAR_CLEARANCE } from '@/navigation/tabs/GlassTabBar';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

const LOGOUT_CONFIRMATION_TIMEOUT_MS = 8000;

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function AccountScreen() {
  const auth = usePrivyAuth();
  const walletProvisioning = useWalletProvisioning();
  const tradingSession = useTradingSession();
  const [addressCopied, setAddressCopied] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutRequested, setLogoutRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!logoutRequested || (auth.isReady && !auth.isAuthenticated)) return;

    const timer = setTimeout(() => {
      setLogoutRequested(false);
      setSigningOut(false);
      setError('Sign out could not be confirmed. Please try again.');
    }, LOGOUT_CONFIRMATION_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [auth.isAuthenticated, auth.isReady, logoutRequested]);

  const copyAddress = async () => {
    const address = walletProvisioning.embeddedWalletAddress;
    if (!address) return;

    try {
      await Clipboard.setStringAsync(address);
      setAddressCopied(true);
      setError(null);
    } catch {
      setError('The wallet address could not be copied. Please try again.');
    }
  };

  const handlePrivateWallet = () => {
    switch (tradingSession.status) {
      case 'inactive':
        void tradingSession.activate();
        return;
      case 'error':
        tradingSession.retryRestore();
        return;
      case 'ready':
        Alert.alert(
          'Rotate private wallet?',
          'Rotation proceeds only after balances, collateral, positions, orders, and pending private operations are confirmed empty.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Verify and rotate',
              onPress: () => void tradingSession.rotate(),
            },
          ],
        );
    }
  };

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

  const privateWalletActionable =
    tradingSession.status === 'inactive' ||
    tradingSession.status === 'error' ||
    tradingSession.status === 'ready';
  const address = walletProvisioning.embeddedWalletAddress;

  return (
    <AppScreen>
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>
          Profile
        </Text>

        <View style={styles.identity}>
          <View accessibilityElementsHidden style={styles.avatar}>
            <MaterialCommunityIcons
              color={colors.accentSoft}
              name="account-outline"
              size={30}
            />
          </View>
          <View style={styles.identityCopy}>
            <Text style={styles.identityLabel}>Public wallet</Text>
            <Text
              accessibilityLabel={address ?? walletProvisioningLabel(walletProvisioning.status)}
              numberOfLines={1}
              selectable={address !== null}
              style={styles.address}
            >
              {address ? shortenAddress(address) : walletProvisioningLabel(walletProvisioning.status)}
            </Text>
          </View>
          {address ? (
            <PressableScale
              accessibilityLabel={addressCopied ? 'Wallet address copied' : 'Copy wallet address'}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => void copyAddress()}
              style={styles.copyButton}
            >
              <MaterialCommunityIcons
                color={addressCopied ? colors.positive : colors.textSecondary}
                name={addressCopied ? 'check' : 'content-copy'}
                size={20}
              />
            </PressableScale>
          ) : null}
        </View>

        {walletProvisioning.status === 'error' ||
        walletProvisioning.status === 'needs-recovery' ? (
          <ProfileGroup title="Wallet recovery">
            <ProfileRow
              detail="Reconnect the same Privy identity used on this device."
              icon="wallet-outline"
              onPress={() => void walletProvisioning.retry()}
              title={walletProvisioning.isProvisioning ? 'Restoring wallet' : 'Retry wallet restore'}
              trailing={walletProvisioning.isProvisioning ? 'Working' : null}
            />
          </ProfileGroup>
        ) : null}

        <ProfileGroup title="Settings">
          <ProfileRow
            detail={privateWalletDescription(tradingSession.status)}
            icon="shield-key-outline"
            onPress={privateWalletActionable ? handlePrivateWallet : null}
            title={privateWalletTitle(tradingSession.status)}
            trailing={privateWalletSettingLabel(tradingSession.status)}
          />
          <ProfileRow
            detail="Lessons, quests, and earned progress will appear after the learning modules are built."
            divided
            icon="book-open-page-variant-outline"
            onPress={null}
            title="Learning and XP"
            trailing="Planned"
          />
          <ProfileRow
            detail="See what Perpal, the trading venue, and public Solana activity can observe."
            divided
            icon="shield-lock-outline"
            onPress={() => Alert.alert(
              'Privacy and custody',
              'Perpal never holds your signing keys or funds. Umbra can obscure the direct funding link, while public Solana activity and the trading venue can still observe their respective transactions and account activity.',
            )}
            title="Privacy and custody"
            trailing={null}
          />
          <ProfileRow
            detail="Installed application version"
            divided
            icon="information-outline"
            onPress={null}
            title="App version"
            trailing={Application.nativeApplicationVersion ?? 'Unavailable'}
          />
        </ProfileGroup>

        <ProfileGroup title="Account">
          <ProfileRow
            destructive
            detail="End the current Privy session on this device."
            icon="logout-variant"
            onPress={signingOut ? null : () => void handleSignOut()}
            title={signingOut ? 'Signing out' : 'Sign out'}
            trailing={null}
          />
        </ProfileGroup>

        {tradingSession.recovery ? (
          <Text accessibilityRole="alert" selectable style={styles.error}>
            Private wallet recovery needs attention before trading can resume.
          </Text>
        ) : null}
        {tradingSession.error ? (
          <Text accessibilityRole="alert" selectable style={styles.error}>
            {tradingSession.error}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" selectable style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>
    </AppScreen>
  );
}

function ProfileGroup({ children, title }: { readonly children: ReactNode; readonly title: string }) {
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.groupTitle}>
        {title}
      </Text>
      <View style={styles.groupSurface}>{children}</View>
    </View>
  );
}

function ProfileRow({
  destructive = false,
  detail,
  divided = false,
  icon,
  onPress,
  title,
  trailing,
}: {
  readonly destructive?: boolean;
  readonly detail: string;
  readonly divided?: boolean;
  readonly icon: IconName;
  readonly onPress: (() => void) | null;
  readonly title: string;
  readonly trailing: string | null;
}) {
  const content = (
    <>
      <View accessibilityElementsHidden style={styles.rowIcon}>
        <MaterialCommunityIcons
          color={destructive ? colors.negative : colors.accentSoft}
          name={icon}
          size={22}
        />
      </View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, destructive && styles.destructive]}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      {trailing ? <Text style={styles.trailing}>{trailing}</Text> : null}
      {onPress ? (
        <MaterialCommunityIcons color={colors.textMuted} name="chevron-right" size={22} />
      ) : null}
    </>
  );

  if (onPress === null) {
    return <View style={[styles.row, divided && styles.divided]}>{content}</View>;
  }

  return (
    <PressableScale
      accessibilityHint={detail}
      accessibilityLabel={trailing ? `${title}. ${trailing}` : title}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.row, divided && styles.divided]}
    >
      {content}
    </PressableScale>
  );
}

function shortenAddress(address: string): string {
  return address.length <= 16 ? address : `${address.slice(0, 8)}…${address.slice(-8)}`;
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

function privateWalletTitle(
  status: ReturnType<typeof useTradingSession>['status'],
): string {
  switch (status) {
    case 'inactive': return 'Activate private trading';
    case 'ready': return 'Rotate private wallet';
    case 'error': return 'Restore private trading';
    default: return 'Private trading';
  }
}

function privateWalletSettingLabel(
  status: ReturnType<typeof useTradingSession>['status'],
): string {
  switch (status) {
    case 'waiting-for-wallet': return 'Waiting';
    case 'restoring': return 'Restoring';
    case 'inactive': return 'Inactive';
    case 'activating': return 'Activating';
    case 'rotating': return 'Checking';
    case 'ready': return 'Active';
    case 'recovery-required': return 'Recovery';
    case 'error': return 'Unavailable';
  }
}

function privateWalletDescription(
  status: ReturnType<typeof useTradingSession>['status'],
): string {
  switch (status) {
    case 'inactive': return 'Create or restore the device-held trading wallet.';
    case 'ready': return 'Rotation is available only after every private and venue balance is empty.';
    case 'error': return 'Retry the secure restore without creating a new identity.';
    case 'recovery-required': return 'Resolve the saved identity mismatch before trading.';
    default: return 'Secure wallet setup is in progress.';
  }
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    gap: spacing.xl,
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: TAB_BAR_CLEARANCE,
  },
  title: { ...typography.title, color: colors.textPrimary },
  identity: {
    minHeight: 84,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  avatar: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  identityCopy: { flex: 1, minWidth: 0 },
  identityLabel: { ...typography.caption, color: colors.textMuted },
  address: {
    ...typography.label,
    marginTop: spacing.xxs,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  copyButton: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  group: { gap: spacing.xs },
  groupTitle: {
    ...typography.caption,
    paddingHorizontal: spacing.xs,
    color: colors.textMuted,
  },
  groupSurface: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceElevated,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { ...typography.label, color: colors.textPrimary },
  rowDetail: {
    ...typography.caption,
    marginTop: spacing.xxs,
    color: colors.textSecondary,
  },
  trailing: {
    ...typography.caption,
    maxWidth: 86,
    color: colors.textMuted,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  destructive: { color: colors.negative },
  error: { ...typography.bodyCompact, color: colors.negative },
});
