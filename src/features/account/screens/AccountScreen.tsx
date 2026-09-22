import * as Application from 'expo-application';
import { useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import { AppScreen } from '@/components/layout/AppScreen';
import { useContentGutter } from '@/components/layout/useContentGutter';
import { layoutMorph } from '@/components/motion/layoutMorph';
import { RiseInView } from '@/components/motion/RiseInView';
import { CopyableAddress } from '@/components/ui/CopyableAddress';
import { ProfileHeader } from '@/features/account/components/ProfileHeader';
import {
  TradingWalletRecoveryDialog,
  TradingWalletRotationDialog,
} from '@/features/account/components/TradingWalletDialogs';
import {
  SETTINGS_ROW_TEXT_SCALE,
  SettingsGroup,
  SettingsRow,
} from '@/features/account/components/SettingsList';
import { usePrivyAuth } from '@/integrations/privy/usePrivyAuth';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { TAB_BAR_CLEARANCE } from '@/navigation/tabs/GlassTabBar';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { showAppToast } from '@/storage/appToast';
import { colors, layout, motion, spacing } from '@/theme/tokens';
import {
  useTradingSession,
  type TradingSessionStatus,
} from '@/wallet/trading/TradingSessionProvider';
import type { TradingWalletRotationPlan } from '@/wallet/trading/rotationSafety';

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
  ready: { label: 'Rotate wallet', spoken: 'Rotate private wallet' },
  error: { label: 'Retry wallet setup', spoken: 'Retry private wallet setup' },
  recovery: { label: 'Review recovery', spoken: 'Review private wallet recovery' },
  resume: { label: 'Resume rotation', spoken: 'Resume private wallet rotation' },
} as const;

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
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [rotationPlan, setRotationPlan] = useState<TradingWalletRotationPlan | null>(null);
  const [walletActionLoading, setWalletActionLoading] = useState(false);
  const version = Application.nativeApplicationVersion ?? 'Unavailable';

  const handlePrivateWallet = () => {
    switch (session.status) {
      case 'error':
        session.retryRestore();
        return;
      case 'ready':
        void reviewRotation();
        return;
      case 'recovery-required':
        setRecoveryOpen(true);
        return;
      default:
        return;
    }
  };

  const reviewRotation = async () => {
    if (walletActionLoading) return;
    setWalletActionLoading(true);
    try {
      setRotationPlan(await session.prepareRotation());
    } catch (cause) {
      showAppToast({
        outcome: 'error',
        message: cause instanceof Error ? cause.message : 'Rotation could not be reviewed.',
      });
    } finally {
      setWalletActionLoading(false);
    }
  };

  const confirmRotation = async () => {
    const plan = rotationPlan;
    if (plan === null || walletActionLoading) return;
    setWalletActionLoading(true);
    try {
      await session.rotate(plan);
      setRotationPlan(null);
    } finally {
      setWalletActionLoading(false);
    }
  };

  const confirmRecovery = async () => {
    if (walletActionLoading) return;
    setWalletActionLoading(true);
    try {
      await session.recover();
      setRecoveryOpen(false);
    } catch (cause) {
      showAppToast({
        outcome: 'error',
        message: cause instanceof Error ? cause.message : 'Recovery paused. Identity kept.',
      });
    } finally {
      setWalletActionLoading(false);
    }
  };

  const handleSignOut = () => {
    if (signOutInFlight.current) return;

    signOutInFlight.current = true;
    setSigningOut(true);
    showOnboardingIntro();

    void auth.logout()
      .catch(() => showAppToast({
        outcome: 'error',
        message: 'Sign out did not complete.',
      }))
      .finally(() => {
        signOutInFlight.current = false;
        setSigningOut(false);
      });
  };

  const publicFallback = publicWalletFallback(wallet.status);
  // Memoized because it is a style object handed to four `RiseInView`s: a fresh literal every render
  // would give each of them a new style identity and defeat the layout spring they animate with.
  const gutterWidth = useContentGutter();
  const gutter = useMemo(
    () => ({ paddingHorizontal: gutterWidth }),
    [gutterWidth],
  );

  const privateAction = readPrivateAction(session.status, session.rotationPending);
  // Only when something is off or in flight. A wallet that is simply working needs no word beside
  // it — the address beside the label is the proof, and a standing "Active" was one more thing to
  // read on a screen that has nothing to report.
  //
  // This row no longer shimmers while the key is being derived. It used to show a skeleton *and* the
  // word "Restoring", which was the same fact told twice in two places; with one slot to spend, the
  // word is the half worth keeping — it names which stage the wallet is at, where a shimmer only says
  // that something is happening.
  const privateState = session.status === 'ready'
    ? undefined
    : privateWalletState(session.status);
  const walletRetryable = wallet.status === 'error' || wallet.status === 'needs-recovery';
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

      <RiseInView delay={motion.rise.stagger} layout={layoutMorph()} style={gutter}>
        <SettingsGroup title="WALLETS">
          <SettingsRow
            accessibilityLabel="Public wallet"
            accessory={wallet.status === 'provisioning' ? (
              <SkeletonText align="right" role="caption" width={96} />
            ) : (
              <CopyableAddress
                address={wallet.embeddedWalletAddress}
                fallback={publicFallback}
                maxFontSizeMultiplier={SETTINGS_ROW_TEXT_SCALE}
                subject="public wallet address"
                tone="secondary"
              />
            )}
            icon="wallet"
            label="Public wallet"
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
            // The state word and the address contend for one slot, and the word wins whenever there
            // is one. That is not a space compromise: every status that produces a word is a status
            // where the address on file is stale, about to be replaced, or not usable yet, so showing
            // it would offer something to copy that should not be copied. A working wallet has no
            // word, and then the address is the whole point of the row.
            //
            // Spread rather than passed directly: under `exactOptionalPropertyTypes` an optional prop
            // will not accept an explicit `undefined`.
            {...(privateState === undefined
              ? {
                accessory: (
                  <CopyableAddress
                    address={session.address}
                    fallback={publicFallback}
                    maxFontSizeMultiplier={SETTINGS_ROW_TEXT_SCALE}
                    subject="private wallet address"
                    tone="secondary"
                  />
                ),
              }
              : { value: privateState })}
          />
          {privateAction === null ? null : (
            <SettingsRow
              accessibilityLabel={privateAction.spoken}
              icon="rotate"
              label={privateAction.label}
              loading={walletActionLoading}
              onPress={handlePrivateWallet}
            />
          )}
        </SettingsGroup>
      </RiseInView>

      <RiseInView delay={motion.rise.stagger * 2} layout={layoutMorph()} style={gutter}>
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

      <RiseInView delay={motion.rise.stagger * 3} layout={layoutMorph()} style={gutter}>
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

      <RiseInView delay={motion.rise.stagger * 4} layout={layoutMorph()} style={gutter}>
        <SettingsGroup title="ABOUT">
          {/* The build, where iOS keeps it: a row with the number on the right. */}
          <SettingsRow icon="info" label="Version" value={version} />
        </SettingsGroup>
      </RiseInView>

      <TradingWalletRecoveryDialog
        error={session.error}
        loading={walletActionLoading}
        onCancel={() => setRecoveryOpen(false)}
        onConfirm={() => void confirmRecovery()}
        recovery={session.recovery}
        visible={recoveryOpen}
      />
      <TradingWalletRotationDialog
        loading={walletActionLoading}
        onCancel={() => setRotationPlan(null)}
        onConfirm={() => void confirmRotation()}
        plan={rotationPlan}
      />

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
    showAppToast({ outcome: 'error', message: unavailable });
  }
}

function readPrivateAction(
  status: TradingSessionStatus,
  rotationPending: boolean,
): (typeof PRIVATE_ACTIONS)[keyof typeof PRIVATE_ACTIONS] | null {
  if (status === 'recovery-required') return PRIVATE_ACTIONS.recovery;
  if (status === 'ready') return rotationPending ? PRIVATE_ACTIONS.resume : PRIVATE_ACTIONS.ready;
  return status === 'error' ? PRIVATE_ACTIONS.error : null;
}

/** The private wallet's state as one word, for every state except a working one. */
function privateWalletState(status: TradingSessionStatus): string {
  switch (status) {
    case 'waiting-for-wallet': return 'Waiting';
    case 'restoring': return 'Restoring';
    case 'inactive': return 'Preparing';
    case 'activating': return 'Activating';
    case 'rotating': return 'Checking';
    case 'ready': return 'Active';
    case 'recovery-required': return 'Recovery';
    case 'error': return 'Retry needed';
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
});
