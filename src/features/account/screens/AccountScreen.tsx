import * as Application from 'expo-application';
import { useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { AppScreen } from '@/components/layout/AppScreen';
import { layoutMorph } from '@/components/motion/layoutMorph';
import { RiseInView } from '@/components/motion/RiseInView';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { ProfileHeader } from '@/features/account/components/ProfileHeader';
import {
  SettingsGroup,
  SettingsRow,
} from '@/features/account/components/SettingsList';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { TAB_BAR_CLEARANCE } from '@/navigation/tabs/GlassTabBar';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, motion, spacing, typography } from '@/theme/tokens';
import {
  useTradingSession,
  type TradingSessionStatus,
} from '@/wallet/trading/TradingSessionProvider';

/** Where support goes. Shown in full on the row, so nobody has to open a link to read it. */
const SUPPORT_EMAIL = 'perpal.app@gmail.com';
const X_HANDLE = '@PerpalApp';
const X_URL = 'https://x.com/PerpalApp';

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
 * Profile: who this device is, the two wallets it holds, and how to reach us.
 *
 * A gradient band at the top carrying the identity, and grouped settings surfaces below it. The
 * split is deliberate: the band is the one place on the screen with any colour or curve to it, and
 * everything under it is a list, which is what a settings screen should read as.
 *
 * Nothing here is placeholder. An earlier pass carried an experience counter and a level, both
 * derived from a store nothing wrote to, which meant a permanent row of zeroes dressed as
 * progress. Every value on this screen comes from the wallet provisioning state, the trading
 * session, or the build.
 */
export function AccountScreen() {
  const auth = usePrivyAuth();
  const wallet = useWalletProvisioning();
  const session = useTradingSession();
  const { showOnboardingIntro } = useAppPreferences();
  const signOutInFlight = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = Application.nativeApplicationVersion ?? 'Unavailable';

  const handlePrivateWallet = () => {
    switch (session.status) {
      case 'inactive':
        void session.activate();
        return;
      case 'error':
        session.retryRestore();
        return;
      case 'ready':
        // The preconditions are stated at the point of consent rather than standing on the page:
        // rotation is rare, and the row is not where that sentence earns its space.
        setRotateOpen(true);
        return;
      default:
        return;
    }
  };

  const handleSignOut = () => {
    if (signOutInFlight.current) return;

    signOutInFlight.current = true;
    setSigningOut(true);
    setError(null);
    showOnboardingIntro();

    void auth.logout()
      .catch(() => setError('Sign out could not be completed. Try again.'))
      .finally(() => {
        signOutInFlight.current = false;
        setSigningOut(false);
      });
  };

  const publicFallback = publicWalletFallback(wallet.status);
  const privateAction = readPrivateAction(session.status);
  // A wallet still being derived has an address on its way, so its row shimmers. A wallet that is
  // inactive or unrecoverable has none coming, and the state on the right says so without a line
  // of placeholder pretending otherwise.
  const privatePending = session.address === null && isDeriving(session.status);
  // Only when something is off or in flight. A wallet that is simply working needs no word beside
  // it — the address under the label is the proof, and a standing "Active" was one more thing to
  // read on a screen that has nothing to report.
  const privateState = session.status === 'ready'
    ? undefined
    : privateWalletState(session.status);
  const walletRetryable = wallet.status === 'error' || wallet.status === 'needs-recovery';
  const alerts = [
    session.recovery === null ? null : 'Private wallet recovery is required before trading.',
    session.error,
    error,
  ].filter((message): message is string => message !== null);

  return (
    // A plain tinted fill rather than a gradient: the band at the top is the gradient, and a second
    // ramp under it would give the page a direction of its own to argue with. Mounted through
    // `background`, so it sits outside the scroller and outside the safe area — the tint reaches the
    // screen's edges instead of stopping where the content column does.
    <AppScreen background={<View style={styles.page} />} contentContainerStyle={styles.content}>
      {/* Every block carries the same layout spring, and it has to be every one of them:
          Reanimated places a block further down at its final position on the frame after a change,
          so animating only the one that resized leaves its neighbours snapping around it. Shared
          physics for the same reason — two springs at different rates come apart. */}
      <RiseInView layout={layoutMorph()}>
        <ProfileHeader address={wallet.embeddedWalletAddress} />
      </RiseInView>

      <RiseInView delay={motion.rise.stagger} layout={layoutMorph()} style={styles.group}>
        <SettingsGroup title="WALLETS">
          <SettingsRow
            accessibilityLabel="Public wallet"
            icon="wallet"
            label="Public wallet"
            subtitle={wallet.status === 'provisioning' ? (
              <SkeletonText role="eyebrow" width={124} />
            ) : (
              <CopyableAddress
                address={wallet.embeddedWalletAddress}
                fallback={publicFallback}
                role="micro"
                subject="public wallet address"
                wide
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
            accessibilityLabel={privateState === undefined
              ? 'Private wallet'
              : `Private wallet, ${privateState}`}
            icon="shield"
            label="Private wallet"
            subtitle={privatePending ? (
              <SkeletonText role="eyebrow" width={124} />
            ) : session.address === null ? undefined : (
              <CopyableAddress
                address={session.address}
                fallback={publicFallback}
                role="micro"
                subject="private wallet address"
                wide
              />
            )}
            // Spread rather than passed directly: under `exactOptionalPropertyTypes` an optional
            // prop will not accept an explicit `undefined`, and a working wallet has no state word.
            {...(privateState === undefined ? {} : { value: privateState })}
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
        <SettingsGroup title="SUPPORT">
          {/* The address is printed on the row rather than hidden behind the label, so it can be
              read and typed elsewhere when no mail client is set up on the device. */}
          <SettingsRow
            accessibilityHint="Opens a new mail draft to Perpal support"
            accessibilityLabel={`Email support at ${SUPPORT_EMAIL}`}
            icon="mail"
            label="Email support"
            onPress={() => void openLink(mailtoUrl(version), 'Mail is unavailable on this device.')}
            value={SUPPORT_EMAIL}
          />
          <SettingsRow
            accessibilityHint="Opens the Perpal account on X in your browser"
            accessibilityLabel={`Perpal on X, ${X_HANDLE}`}
            icon="x"
            label="Perpal on X"
            onPress={() => void openLink(X_URL, 'The link could not be opened.')}
            value={X_HANDLE}
          />
        </SettingsGroup>
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 3} layout={layoutMorph()} style={styles.group}>
        <SettingsGroup title="ACCOUNT">
          <SettingsRow
            accessibilityHint="Ends the Privy session on this device"
            icon="signOut"
            iconTone="negative"
            label="Sign out"
            loading={signingOut}
            onPress={handleSignOut}
            tone="destructive"
          />
        </SettingsGroup>
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 4} layout={layoutMorph()} style={styles.group}>
        <SettingsGroup title="ABOUT">
          {/* The build, where iOS keeps it: a row with the number on the right. */}
          <SettingsRow icon="info" label="Version" value={version} />
        </SettingsGroup>
      </RiseInView>

      <ConfirmDialog
        confirmLabel="Rotate"
        message={'Rotation proceeds only after balances, collateral, positions, orders, and pending '
          + 'private operations are confirmed empty.'}
        onCancel={() => setRotateOpen(false)}
        onConfirm={() => {
          setRotateOpen(false);
          void session.rotate();
        }}
        title="Rotate private wallet?"
        visible={rotateOpen}
      />

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

/**
 * A support draft with the build already in its subject.
 *
 * Carried in the subject rather than asked for in the reply, because the version is the first
 * thing any report needs and the reader should not have to go and find it. Encoded, since a
 * subject travels in a query string and a bare space would truncate it on some clients.
 */
function mailtoUrl(version: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Perpal support (${version})`)}`;
}

/**
 * Hands a URL to the platform, and says so plainly when nothing can take it.
 *
 * `openURL` rejects rather than returning false when there is no handler — a device with no mail
 * client configured, most often — so a silent failure here would be a row that does nothing when
 * pressed.
 */
async function openLink(url: string, unavailable: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Could not open', unavailable);
  }
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

/** The private wallet's state as one word, for every state except a working one. */
function privateWalletState(status: TradingSessionStatus): string {
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

/** Stands in for an address while there is none. A state, not a sentence. */
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
  page: { flex: 1, backgroundColor: colors.backgroundTinted },
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
