import * as Application from 'expo-application';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { AppScreen } from '@/components/layout/AppScreen';
import { layoutMorph } from '@/components/motion/layoutMorph';
import { RiseInView } from '@/components/motion/RiseInView';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { ProfileHeader } from '@/features/account/components/ProfileHeader';
import {
  SettingsGroup,
  SettingsRow,
  StatePill,
  type StatePillTone,
} from '@/features/account/components/SettingsList';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { TAB_BAR_CLEARANCE } from '@/navigation/tabs/GlassTabBar';
import { colors, layout, motion, spacing, typography } from '@/theme/tokens';
import {
  useTradingSession,
  type TradingSessionStatus,
} from '@/wallet/trading/TradingSessionProvider';

const LOGOUT_CONFIRMATION_TIMEOUT_MS = 8_000;

const PRIVACY_DISCLOSURE =
  'Perpal never holds your signing keys or funds. Umbra can obscure the direct funding link, '
  + 'while public Solana activity and the trading venue can still observe their respective '
  + 'transactions and account activity.';

/**
 * The private wallet's one action, per session state.
 *
 * The spoken label is spelled out because a screen reader lands on the row without the group
 * header beside it, while the visible label can lean on the group it sits in.
 */
const PRIVATE_ACTIONS = {
  inactive: { label: 'Activate private wallet', spoken: 'Activate private wallet' },
  ready: { label: 'Rotate wallet', spoken: 'Rotate private wallet' },
  error: { label: 'Retry restore', spoken: 'Retry private wallet restore' },
} as const satisfies Partial<
  Record<TradingSessionStatus, { readonly label: string; readonly spoken: string }>
>;

/**
 * Profile: who this device is, and the two wallets it holds.
 *
 * A gradient panel at the top carrying the identity, and grouped settings surfaces below it. The
 * split is deliberate: the panel is the one place on the screen with any colour or curve to it,
 * and everything under it is a list, which is what a settings screen should read as.
 *
 * Nothing here is placeholder. An earlier pass carried an experience counter and a level, both
 * derived from a store nothing wrote to, which meant a permanent row of zeroes dressed as
 * progress — the app has no learning modules, so it makes no claim about them. Every figure on
 * this screen comes from the wallet provisioning state, the trading session, or the build.
 */
export function AccountScreen() {
  const auth = usePrivyAuth();
  const wallet = useWalletProvisioning();
  const session = useTradingSession();
  const [signingOut, setSigningOut] = useState(false);
  const [logoutRequested, setLogoutRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!logoutRequested || (auth.isReady && !auth.isAuthenticated)) return undefined;

    const timer = setTimeout(() => {
      setLogoutRequested(false);
      setSigningOut(false);
      setError('Sign out could not be confirmed. Try again.');
    }, LOGOUT_CONFIRMATION_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [auth.isAuthenticated, auth.isReady, logoutRequested]);

  const handlePrivateWallet = () => {
    switch (session.status) {
      case 'inactive':
        void session.activate();
        return;
      case 'error':
        session.retryRestore();
        return;
      case 'ready':
        // The preconditions are stated here, at the point of consent, rather than standing on
        // the page: rotation is rare, and the row is not where that sentence earns its space.
        Alert.alert(
          'Rotate private wallet?',
          'Rotation proceeds only after balances, collateral, positions, orders, and pending '
          + 'private operations are confirmed empty.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Verify and rotate', onPress: () => void session.rotate() },
          ],
        );
        return;
      default:
        return;
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
      setError('Sign out could not be completed. Try again.');
    }
  };

  const publicFallback = publicWalletFallback(wallet.status);
  const privateState = privateWalletState(session.status);
  const privateAction = readPrivateAction(session.status);
  // A wallet still being derived has an address on its way, so its row shimmers. A wallet that
  // is inactive or unrecoverable has none coming, and the state pill says so without a line of
  // placeholder pretending otherwise.
  const privatePending = session.address === null && isDeriving(session.status);
  const walletRetryable = wallet.status === 'error' || wallet.status === 'needs-recovery';
  const alerts = [
    session.recovery === null ? null : 'Private wallet recovery is required before trading.',
    session.error,
    error,
  ].filter((message): message is string => message !== null);

  return (
    <AppScreen contentContainerStyle={styles.content}>
      {/* Every block carries the same layout spring, and it has to be every one of them:
          Reanimated places a block further down at its final position on the frame after a
          change, so animating only the one that resized leaves its neighbours snapping around
          it. Shared physics for the same reason — two springs at different rates come apart. */}
      <RiseInView layout={layoutMorph()}>
        <ProfileHeader address={wallet.embeddedWalletAddress} />
      </RiseInView>

      <RiseInView delay={motion.rise.stagger} layout={layoutMorph()} style={styles.group}>
        <SettingsGroup title="WALLETS">
          <SettingsRow
            accessibilityLabel="Public wallet"
            icon="wallet"
            label="Public wallet"
            subtitle={(
              <CopyableAddress
                address={wallet.embeddedWalletAddress}
                fallback={publicFallback}
                subject="public wallet address"
              />
            )}
          />
          {walletRetryable ? (
            <SettingsRow
              accessibilityHint="Reconnects the same Privy identity used on this device"
              icon="rotate"
              label={wallet.isProvisioning ? 'Restoring wallet' : 'Retry wallet restore'}
              onPress={wallet.isProvisioning ? null : () => void wallet.retry()}
            />
          ) : null}
          <SettingsRow
            accessibilityLabel={`Private wallet, ${privateState.label}`}
            icon="shield"
            label="Private wallet"
            subtitle={privatePending ? (
              <SkeletonText role="caption" width={124} />
            ) : session.address === null ? undefined : (
              <CopyableAddress
                address={session.address}
                fallback={privateState.label}
                subject="private wallet address"
              />
            )}
            trailing={<StatePill label={privateState.label} tone={privateState.tone} />}
          />
          {privateAction === null ? null : (
            <SettingsRow
              accessibilityLabel={privateAction.spoken}
              icon="rotate"
              label={privateAction.label}
              onPress={handlePrivateWallet}
            />
          )}
        </SettingsGroup>
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 2} layout={layoutMorph()} style={styles.group}>
        <SettingsGroup title="ACCOUNT">
          <SettingsRow
            accessibilityHint="Explains what Perpal, the trading venue, and public Solana activity can observe"
            icon="lock"
            label="Privacy and custody"
            onPress={() => Alert.alert('Privacy and custody', PRIVACY_DISCLOSURE)}
          />
          <SettingsRow
            accessibilityHint="Ends the Privy session on this device"
            icon="signOut"
            iconTone="negative"
            label={signingOut ? 'Signing out' : 'Sign out'}
            onPress={signingOut ? null : () => void handleSignOut()}
            tone="destructive"
          />
        </SettingsGroup>
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 3} layout={layoutMorph()} style={styles.group}>
        <SettingsGroup title="ABOUT">
          {/* The build, where iOS keeps it: a row with the number on the right. It was a row
              with the caption "Installed application version" under it, which is a sentence
              explaining a version number. */}
          <SettingsRow
            icon="info"
            label="Version"
            value={Application.nativeApplicationVersion ?? 'Unavailable'}
          />
        </SettingsGroup>
      </RiseInView>

      {alerts.length === 0 ? null : (
        <RiseInView layout={layoutMorph()} style={styles.alerts}>
          {alerts.map((message, index) => (
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              key={index}
              selectable
              style={styles.alert}
            >
              {message}
            </Text>
          ))}
        </RiseInView>
      )}
    </AppScreen>
  );
}

/** True while an address is genuinely on its way, which is the only state worth shimmering. */
function isDeriving(status: TradingSessionStatus): boolean {
  return status === 'waiting-for-wallet'
    || status === 'restoring'
    || status === 'activating';
}

function readPrivateAction(
  status: TradingSessionStatus,
): (typeof PRIVATE_ACTIONS)[keyof typeof PRIVATE_ACTIONS] | null {
  return status === 'inactive' || status === 'ready' || status === 'error'
    ? PRIVATE_ACTIONS[status]
    : null;
}

/**
 * The private wallet's state as one word.
 *
 * The word is the state; the tone only agrees with it. Violet for work in flight, green for a
 * usable wallet, red for something that needs attention, grey for a wallet that simply has not
 * been set up — which is not a fault and should not be coloured like one.
 */
function privateWalletState(
  status: TradingSessionStatus,
): { readonly label: string; readonly tone: StatePillTone } {
  switch (status) {
    case 'waiting-for-wallet': return { label: 'Waiting', tone: 'neutral' };
    case 'restoring': return { label: 'Restoring', tone: 'accent' };
    case 'inactive': return { label: 'Inactive', tone: 'neutral' };
    case 'activating': return { label: 'Activating', tone: 'accent' };
    case 'rotating': return { label: 'Checking', tone: 'accent' };
    case 'ready': return { label: 'Active', tone: 'positive' };
    case 'recovery-required': return { label: 'Recovery', tone: 'negative' };
    case 'error': return { label: 'Unavailable', tone: 'negative' };
  }
}

/** Stands in for the public address while there is none. A state, not a sentence. */
function publicWalletFallback(
  status: ReturnType<typeof useWalletProvisioning>['status'],
): string {
  switch (status) {
    case 'unauthenticated': return 'Signed out';
    case 'provisioning': return 'Restoring';
    case 'ready': return 'Unavailable';
    case 'needs-recovery': return 'Recovery required';
    case 'error': return 'Unavailable';
  }
}

const styles = StyleSheet.create({
  // No horizontal padding and no top padding, which is what lets the gradient band run to the
  // edges of the content column and start flush against the safe area. The gutter moves down to
  // the groups instead, so only the band is full width.
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    // The floating bar draws over this screen, so the last group buys its own room.
    paddingBottom: TAB_BAR_CLEARANCE,
    gap: spacing.lg,
  },
  group: { paddingHorizontal: layout.screenPadding },
  alerts: { gap: spacing.xs, paddingHorizontal: layout.screenPadding },
  alert: { ...typography.bodyCompact, color: colors.negative },
});
