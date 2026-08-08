import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { IOSLoader } from '@/components/feedback/IOSLoader';
import { AppScreen } from '@/components/layout/AppScreen';
import { EmptyState } from '@/components/feedback/EmptyState';
import { readAppConfig } from '@/config/appConfig';
import { PacificaPortfolioContent } from '@/features/portfolio/components/PacificaPortfolioContent';
import { usePacificaPortfolio } from '@/features/portfolio/hooks/usePacificaPortfolio';
import { colors, layout, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function PortfolioScreen() {
  const router = useRouter();
  const config = readAppConfig();
  const session = useTradingSession();
  const portfolio = usePacificaPortfolio(
    config.ok ? config.value.perps.pacificaApiOrigin : '',
    session.status === 'ready' ? session.address : null,
  );

  if (!config.ok) {
    return <PortfolioState title="Configuration required" message="The mainnet gateway or Pacifica configuration is invalid." />;
  }

  if (session.status === 'waiting-for-wallet') {
    return (
      <PortfolioState
        action={{ label: 'Open Wallet', onPress: () => router.push('/(tabs)/account') }}
        message="Your public wallet could not be restored. Open Wallet to retry."
        title="Privy wallet required"
      />
    );
  }

  if (session.status === 'restoring' || session.status === 'activating') {
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
          : 'Activate private trading once from Wallet. It restores automatically afterward.'}
        title={recoveryRequired ? 'Trading wallet recovery required' : 'Activate private trading'}
      />
    );
  }

  if (session.address === null || session.signer === null) {
    return <PortfolioState title="Trading signer unavailable" message="Open Wallet and retry the secure restore." />;
  }

  if (portfolio.status === 'error') {
    return <PortfolioState title="Pacifica portfolio unavailable" message="The Pacifica account could not be read. The app will retry while this tab remains open." />;
  }

  if (portfolio.status === 'loading' || portfolio.snapshot === null) {
    return <LoadingState label="Loading Pacifica portfolio" />;
  }

  return <PacificaPortfolioContent snapshot={portfolio.snapshot} />;
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

function LoadingState({ label }: { readonly label: string }) {
  return (
    <AppScreen>
      <View accessibilityLabel={label} style={styles.loading}>
        <IOSLoader size="large" />
        <Text style={styles.message}>{label}</Text>
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
    paddingVertical: spacing.lg,
  },
  loading: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  message: { ...typography.bodyCompact, color: colors.textSecondary },
});
