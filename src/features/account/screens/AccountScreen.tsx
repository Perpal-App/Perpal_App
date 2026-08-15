import * as Application from 'expo-application';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { avatarForAddress } from '@/assets/svg/avatars';
import { SkeletonText } from '@/components/feedback/Skeleton';
import { AppScreen } from '@/components/layout/AppScreen';
import { layoutMorph } from '@/components/motion/layoutMorph';
import { RiseInView } from '@/components/motion/RiseInView';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import {
  ProfileRow,
  ProfileSection,
  StatePill,
  type StatePillTone,
} from '@/features/account/components/ProfileRow';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { TAB_BAR_CLEARANCE } from '@/navigation/tabs/GlassTabBar';
import { colors, gradients, layout, motion, radii, spacing, typography } from '@/theme/tokens';
import {
  useTradingSession,
  type TradingSessionStatus,
} from '@/wallet/trading/TradingSessionProvider';

/**
 * Sized to the label-and-address stack beside it, the same way the home header's avatar is
 * sized to the greeting-and-address block: the disc's top lands with the label and its base
 * with the address.
 */
const AVATAR_SIZE = 52;

const LOGOUT_CONFIRMATION_TIMEOUT_MS = 8_000;

/** Both wallets, so the two blocks name themselves the same way. */
const PUBLIC_TITLE = 'Public wallet';
const PRIVATE_TITLE = 'Private wallet';

const PRIVACY_DISCLOSURE =
  'Perpal never holds your signing keys or funds. Umbra can obscure the direct funding link, '
  + 'while public Solana activity and the trading venue can still observe their respective '
  + 'transactions and account activity.';

/**
 * The private wallet's one action, per session state.
 *
 * The visible label is a verb and nothing more — the section it sits in already says which
 * wallet it acts on. The accessibility label spells that out, because a screen reader lands on
 * the row without the heading beside it.
 */
const PRIVATE_ACTIONS = {
  inactive: { label: 'Activate', spoken: 'Activate private wallet' },
  ready: { label: 'Rotate', spoken: 'Rotate private wallet' },
  error: { label: 'Retry restore', spoken: 'Retry private wallet restore' },
} as const satisfies Partial<
  Record<TradingSessionStatus, { readonly label: string; readonly spoken: string }>
>;

/**
 * Profile: the two wallets this device holds, what can be done with them, and the way out.
 *
 * Built the way the home screen is built — cardless blocks on the page, one staggered
 * entrance, hierarchy from type and spacing rather than from borders. The version it replaced
 * put every item in a filled rounded panel with an icon chip and a sentence of explanation
 * under it, which spent a full screen on four settings and made the least important text the
 * largest thing on it.
 *
 * Every row is one line. Detail lives in what the row opens: the rotation confirmation states
 * its own preconditions, the privacy row states the trust boundary, and neither needs a
 * standing summary on the page.
 */
export function AccountScreen() {
  const auth = usePrivyAuth();
  const wallet = useWalletProvisioning();
  const session = useTradingSession();
  const Avatar = avatarForAddress(wallet.embeddedWalletAddress);
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

  const privateState = privateWalletState(session.status);
  const privateAction = readPrivateAction(session.status);
  // A wallet still being derived has an address on its way, so its row shimmers. A wallet that
  // is inactive or unrecoverable has none coming, and the state beside the heading says so
  // without a line of placeholder pretending otherwise.
  const privatePending = session.address === null && isDeriving(session.status);
  const walletRetryable = wallet.status === 'error' || wallet.status === 'needs-recovery';
  const alerts = [
    session.recovery === null ? null : 'Private wallet recovery is required before trading.',
    session.error,
    error,
  ].filter((message): message is string => message !== null);

  return (
    <AppScreen contentContainerStyle={styles.content}>
      <RiseInView>
        <Text accessibilityRole="header" style={styles.title}>Profile</Text>
      </RiseInView>

      {/* Every block below the title carries the same layout spring, and it has to be every one
          of them: Reanimated places a section further down at its final position on the frame
          after a change, so animating only the block that resized leaves its neighbours snapping
          around it. Shared physics for the same reason — two springs at different rates visibly
          come apart. */}
      <RiseInView delay={motion.rise.stagger} layout={layoutMorph()}>
        <View style={styles.identity}>
          {/* Assigned from the wallet address, so a given wallet always wears the same face here
              and on the home header. Glass with a lit top edge rather than a flat grey fill: a
              solid disc at this size reads as a hole punched in the page. */}
          <View accessibilityElementsHidden style={styles.avatar}>
            <LinearGradient
              colors={gradients.cardSheen.colors}
              locations={gradients.cardSheen.locations}
              style={StyleSheet.absoluteFill}
            />
            <Avatar size={AVATAR_SIZE} />
          </View>
          <View style={styles.identityCopy}>
            <Text accessibilityRole="header" style={styles.blockTitle}>{PUBLIC_TITLE}</Text>
            <CopyableAddress
              address={wallet.embeddedWalletAddress}
              fallback={publicWalletFallback(wallet.status)}
              role="label"
              subject="public wallet address"
            />
          </View>
        </View>

        {walletRetryable ? (
          <ProfileRow
            accessibilityHint="Reconnects the same Privy identity used on this device"
            label={wallet.isProvisioning ? 'Restoring wallet' : 'Retry wallet restore'}
            onPress={wallet.isProvisioning ? null : () => void wallet.retry()}
          />
        ) : null}
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 2} layout={layoutMorph()}>
        <ProfileSection
          title={PRIVATE_TITLE}
          trailing={<StatePill label={privateState.label} tone={privateState.tone} />}
        >
          {privatePending ? (
            <View style={styles.addressRow}>
              <SkeletonText role="label" width={132} />
            </View>
          ) : session.address === null ? null : (
            <View style={styles.addressRow}>
              <CopyableAddress
                address={session.address}
                fallback={privateState.label}
                role="label"
                subject="private wallet address"
              />
            </View>
          )}

          {privateAction === null ? null : (
            <ProfileRow
              accessibilityLabel={privateAction.spoken}
              label={privateAction.label}
              onPress={handlePrivateWallet}
            />
          )}
        </ProfileSection>
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 3} layout={layoutMorph()}>
        <ProfileRow
          accessibilityHint="Explains what Perpal, the trading venue, and public Solana activity can observe"
          label="Privacy and custody"
          onPress={() => Alert.alert('Privacy and custody', PRIVACY_DISCLOSURE)}
        />
        <ProfileRow
          accessibilityHint="Ends the Privy session on this device"
          label={signingOut ? 'Signing out' : 'Sign out'}
          onPress={signingOut ? null : () => void handleSignOut()}
          tone="destructive"
        />
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

      {/* The build, as a footer line. It was a row with an icon and the words "Installed
          application version" under it, which is a caption explaining a version number. */}
      <Text style={styles.version}>
        {`Perpal ${Application.nativeApplicationVersion ?? 'build unavailable'}`}
      </Text>
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
  content: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.md,
    // The floating bar draws over this screen, so the last line buys its own room.
    paddingBottom: TAB_BAR_CLEARANCE,
    gap: spacing.lg,
  },
  title: { ...typography.title, color: colors.textPrimary },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Glass rather than an opaque raise, matching the home header's disc: clipped, so the tint,
  // the sheen and the drawing all take the disc's shape — the figures are drawn square and rely
  // on the caller to crop them.
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassEdge,
    backgroundColor: colors.glassTint,
  },
  identityCopy: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  blockTitle: { ...typography.label, color: colors.textPrimary },
  // The address sits on a row of its own inside the private block, so it keeps the same rule
  // and rhythm as the action under it without borrowing a pressable row's touch target.
  addressRow: {
    minHeight: layout.minTouchTarget,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  alerts: { gap: spacing.xs },
  alert: { ...typography.bodyCompact, color: colors.negative },
  version: { ...typography.caption, color: colors.textMuted },
});
