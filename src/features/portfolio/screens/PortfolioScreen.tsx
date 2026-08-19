import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { SkeletonText } from '@/components/feedback/Skeleton';
import { AppScreen } from '@/components/layout/AppScreen';
import { StatusRowSkeleton } from '@/components/ui/StatusRow';
import { readAppConfig } from '@/config/appConfig';
import { useWalletBalances } from '@/features/account/hooks/useWalletBalances';
import { PacificaPortfolioContent } from '@/features/portfolio/components/PacificaPortfolioContent';
import { usePacificaPortfolio } from '@/features/portfolio/hooks/usePacificaPortfolio';
import { useVelocityAccount } from '@/features/portfolio/hooks/useVelocityAccount';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { TAB_BAR_CLEARANCE } from '@/navigation/tabs/GlassTabBar';
import { layout, spacing } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function PortfolioScreen() {
  const router = useRouter();
  const config = readAppConfig();
  const publicWallet = useWalletProvisioning();
  const session = useTradingSession();
  const portfolio = usePacificaPortfolio(
    config.ok ? config.value.perps.pacificaApiOrigin : '',
    session.status === 'ready' ? session.address : null,
  );
  const velocity = useVelocityAccount({
    historyRpcUrl: config.ok ? config.value.api.rpcUrl : undefined,
    historySigner: session.status === 'ready' ? session.signer : null,
    owner: session.status === 'ready' ? session.address : null,
    programId: config.ok ? config.value.perps.velocityProgramId : '',
    publicRpcUrl: config.ok ? config.value.api.publicRpcUrl : '',
  });
  const walletBalances = useWalletBalances({
    privateAddress: session.status === 'ready' ? session.address : null,
    publicAddress: publicWallet.embeddedWalletAddress,
    signer: session.status === 'ready' ? session.signer : null,
  });

  if (!config.ok) {
    return <PortfolioState title="Configuration required" message="The mainnet wallet configuration is invalid." />;
  }

  if (session.status === 'waiting-for-wallet') {
    if (publicWallet.status !== 'error' && publicWallet.status !== 'needs-recovery') {
      return <LoadingState label="Restoring wallets" />;
    }
    return (
      <PortfolioState
        action={{ label: 'Open Wallet', onPress: () => router.push('/(tabs)/account') }}
        message="Your public wallet could not be restored. Open Wallet to retry."
        title="Privy wallet required"
      />
    );
  }

  if (
    session.status === 'restoring' ||
    session.status === 'inactive' ||
    session.status === 'activating' ||
    session.status === 'rotating'
  ) {
    return <LoadingState label="Preparing private trading" />;
  }

  if (session.status !== 'ready') {
    const recoveryRequired = session.status === 'recovery-required';
    return (
      <PortfolioState
        action={recoveryRequired
          ? undefined
          : { label: 'Open Wallet', onPress: () => router.push('/(tabs)/account') }}
        message={recoveryRequired
          ? 'The derived trading wallet does not match the recorded identity. No new identity was adopted.'
          : 'Private trading setup did not complete. Open Wallet to retry.'}
        title={recoveryRequired ? 'Trading wallet recovery required' : 'Private trading setup paused'}
      />
    );
  }

  if (session.address === null || session.signer === null) {
    return <PortfolioState title="Trading signer unavailable" message="Open Wallet and retry the secure restore." />;
  }

  return (
    <PacificaPortfolioContent
      balances={walletBalances.balances}
      balancesPending={walletBalances.status !== 'ready' && walletBalances.status !== 'error'}
      onBalancesChanged={walletBalances.refresh}
      onPacificaRefresh={portfolio.refresh}
      onVelocityRefresh={velocity.refresh}
      portfolioPending={portfolio.status !== 'ready' && portfolio.status !== 'error'}
      portfolioUnavailable={portfolio.status === 'error'}
      snapshot={portfolio.snapshot}
      velocity={velocity.account.snapshot}
      velocityHistory={velocity.history}
      velocityPending={velocity.account.status === 'loading'}
      velocityUnavailable={velocity.account.status === 'error' || velocity.account.status === 'stale'}
    />
  );
}

function PortfolioState({
  title,
  message,
  action,
}: {
  readonly title: string;
  readonly message: string;
  readonly action?: { readonly label: string; readonly onPress: () => void } | undefined;
}) {
  return (
    <AppScreen>
      <View style={styles.stateContainer}>
        <EmptyState {...(action === undefined ? {} : { action })} message={message} title={title} />
      </View>
    </AppScreen>
  );
}

/**
 * Widths for the summary placeholder. Deliberately uneven, because six identical bars
 * read as a table that failed to load rather than as figures on their way.
 */
const SUMMARY_ROWS: readonly (readonly [number, number])[] = [
  [104, 86],
  [96, 78],
  [128, 82],
];

/**
 * Stands in for `PacificaPortfolioContent`'s header and summary at the same type
 * sizes and gaps, so the real figures land without moving anything.
 *
 * No spinner: a wheel says only "wait", while the shape of the screen that is coming
 * says what is being waited for — and this screen already knows that shape.
 */
function LoadingState({ label }: { readonly label: string }) {
  return (
    <AppScreen>
      <View
        accessibilityLabel={label}
        accessibilityRole="progressbar"
        style={styles.stateContainer}
      >
        <View style={styles.loadingHeader}>
          <SkeletonText role="title" width={148} />
          <SkeletonText role="bodyCompact" width={196} />
        </View>
        <View style={styles.loadingSummary}>
          {SUMMARY_ROWS.map(([labelWidth, valueWidth]) => (
            <StatusRowSkeleton
              key={labelWidth}
              labelWidth={labelWidth}
              valueWidth={valueWidth}
            />
          ))}
        </View>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  stateContainer: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.lg,
    // The floating tab bar draws over this screen, so the last row buys its own room.
    paddingBottom: TAB_BAR_CLEARANCE,
  },
  // Mirrors PacificaPortfolioContent's own header and summary spacing exactly.
  loadingHeader: { paddingBottom: spacing.lg },
  loadingSummary: { gap: spacing.md },
});
