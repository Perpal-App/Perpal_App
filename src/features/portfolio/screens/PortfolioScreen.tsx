import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { IOSLoader } from '@/components/feedback/IOSLoader';
import { AppScreen } from '@/components/layout/AppScreen';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig } from '@/config/appConfig';
import {
  amountFromBaseUnits,
  formatAmount,
  type Amount,
} from '@/domain/money/amount';
import { FlashPortfolioContent } from '@/features/portfolio/components/FlashPortfolioContent';
import { PrivateWithdrawPanel } from '@/features/portfolio/components/PrivateWithdrawPanel';
import { useFlashPortfolio } from '@/features/portfolio/hooks/useFlashPortfolio';
import { useVelocityPortfolio } from '@/features/portfolio/hooks/useVelocityPortfolio';
import { usePublicMarkets } from '@/features/trade/hooks/usePublicMarkets';
import type {
  VelocityPortfolioPosition,
  VelocityPortfolioSnapshot,
} from '@/integrations/perps/velocity/velocityPortfolio';
import { listMainnetMarkets } from '@/integrations/perps/markets/mainnetCatalog';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function PortfolioScreen() {
  const router = useRouter();
  const config = readAppConfig();
  const preferences = useAppPreferences();
  const session = useTradingSession();
  const isSessionReady = session.status === 'ready';
  const isVelocityReady =
    preferences.selectedPerpsProvider === 'velocity' && isSessionReady;
  const isFlashReady =
    preferences.selectedPerpsProvider === 'flash' && isSessionReady;
  const markets = useMemo(() => listMainnetMarkets('velocity'), []);
  const publicMarkets = usePublicMarkets(
    config.ok ? config.value.api.marketDataUrl : '',
    config.ok ? config.value.api.marketStreamUrl : '',
    isVelocityReady,
  );
  const portfolio = useVelocityPortfolio(
    config.ok ? config.value.api.publicRpcUrl : '',
    config.ok ? config.value.perps.velocityProgramId : '',
    isVelocityReady ? session.address : null,
    markets,
    publicMarkets.prices,
  );
  const flashPortfolio = useFlashPortfolio(
    config.ok ? config.value.perps.flashErRpc : '',
    config.ok ? config.value.perps.flashProgramId : '',
    isFlashReady ? session.address : null,
  );

  if (!config.ok) {
    return (
      <PortfolioState
        title="Configuration required"
        message="The mainnet gateway or provider configuration is invalid."
      />
    );
  }

  if (session.status === 'waiting-for-wallet') {
    return (
      <PortfolioState
        title="Privy wallet required"
        message="Your public wallet could not be restored. Open Wallet to retry."
        action={{
          label: 'Open Wallet',
          onPress: () => router.push('/(tabs)/account'),
        }}
      />
    );
  }

  if (session.status === 'restoring' || session.status === 'activating') {
    return <LoadingState label="Preparing private trading" />;
  }

  if (session.status !== 'ready') {
    return (
      <PortfolioState
        title={
          session.status === 'recovery-required'
            ? 'Trading wallet recovery required'
            : 'Activate private trading'
        }
        message={
          session.status === 'recovery-required'
            ? 'The derived trading wallet does not match the recorded identity. No new identity was adopted.'
            : 'Activate private trading once from Wallet. It restores automatically afterward.'
        }
        action={
          session.status === 'recovery-required'
            ? undefined
            : {
                label: 'Open Wallet',
                onPress: () => router.push('/(tabs)/account'),
              }
        }
      />
    );
  }

  if (session.address === null || session.signer === null) {
    return (
      <PortfolioState
        title="Trading signer unavailable"
        message="Open Wallet and retry the secure restore."
      />
    );
  }

  if (preferences.selectedPerpsProvider === 'flash') {
    if (flashPortfolio.status === 'error') {
      return (
        <PortfolioState
          title="Flash portfolio unavailable"
          message="The Flash portfolio could not be read. The app will retry while this tab remains open."
        />
      );
    }

    if (flashPortfolio.status === 'loading' || flashPortfolio.snapshot === null) {
      return <LoadingState label="Loading Flash portfolio" />;
    }

    return (
      <FlashPortfolioContent
        snapshot={flashPortfolio.snapshot}
      />
    );
  }

  if (portfolio.status === 'error') {
    return (
      <PortfolioState
        title="Portfolio unavailable"
        message="The Velocity portfolio could not be read. The app will retry while this tab remains open."
      />
    );
  }

  if (portfolio.status === 'loading' || portfolio.snapshot === null) {
    return <LoadingState label="Loading Velocity portfolio" />;
  }

  return (
    <PortfolioContent snapshot={portfolio.snapshot} />
  );
}

function PortfolioContent({
  snapshot,
}: {
  readonly snapshot: VelocityPortfolioSnapshot;
}) {
  return (
    <AppScreen>
      <View style={styles.container}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>
            Portfolio
          </Text>
          <Text style={styles.subtitle}>Velocity</Text>
        </View>

        {snapshot.margin === null ? null : (
          <View style={styles.summary}>
            <Text accessibilityRole="header" style={styles.positionTitle}>
              Balance and risk
            </Text>
            <StatusRow
              label="Total collateral"
              value={usdt(snapshot.margin.totalCollateral)}
            />
            <StatusRow
              label="Available"
              value={usdt(snapshot.margin.freeCollateral)}
            />
            <StatusRow
              label="Account health"
              value={`${snapshot.margin.healthPercent}%`}
            />
            <StatusRow label="Open orders" value={snapshot.openOrders.toString()} />
          </View>
        )}

        {!snapshot.initialized ? (
          <View style={styles.positions}>
            <InlineState
              title="Add funds to begin"
              message="Open Wallet and add private trading funds. Setup completes automatically."
            />
          </View>
        ) : snapshot.positions.length === 0 ? (
          <InlineState
            title="No open positions"
            message="Your Velocity portfolio is ready and has no open perpetual position."
          />
        ) : (
          <View style={styles.positions}>
            {snapshot.positions.map((position) => (
              <PositionPanel
                key={position.marketIndex}
                position={position}
              />
            ))}
          </View>
        )}

        {snapshot.margin === null && snapshot.initialized ? (
          <InlineState
            title="Aggregate risk unavailable"
            message="The account contains a non-core perpetual or spot position. Those positions are shown where possible, but PerPal will not publish incomplete collateral or liquidation totals."
          />
        ) : null}

        {snapshot.nonCorePositionCount > 0 ? (
          <Text accessibilityRole="alert" style={styles.warning}>
            {snapshot.nonCorePositionCount} non-core Velocity position is shown with
            the values that can be verified. It is excluded from aggregate risk.
          </Text>
        ) : null}

        {snapshot.unsupportedSpotPositionCount > 0 ? (
          <Text accessibilityRole="alert" style={styles.warning}>
            {snapshot.unsupportedSpotPositionCount} non-USDT spot position is not
            included in aggregate risk.
          </Text>
        ) : null}

        {snapshot.initialized ? (
          <PrivateWithdrawPanel provider="velocity" />
        ) : null}
      </View>
    </AppScreen>
  );
}

function PositionPanel({
  position,
}: {
  readonly position: VelocityPortfolioPosition;
}) {
  return (
    <View style={styles.positionPanel}>
      <View style={styles.positionHeader}>
        <Text accessibilityRole="header" style={styles.positionTitle}>
          {position.symbol}
        </Text>
        <Text style={styles.positionSide}>{position.side}</Text>
      </View>
      <StatusRow label="Size" value={formatAmount(position.size)} />
      <StatusRow
        label="Entry price"
        value={position.entryPrice === null ? '—' : money(position.entryPrice)}
      />
      <StatusRow
        label="Oracle PnL"
        value={position.unrealizedPnl === null ? 'Unavailable' : signedMoney(position.unrealizedPnl)}
      />
      <StatusRow
        label="Estimated liquidation"
        value={
          position.liquidationPrice === null
            ? 'Unavailable'
            : money(position.liquidationPrice)
        }
      />
      {position.openOrders > 0 ? (
        <StatusRow label="Open orders" value={position.openOrders.toString()} />
      ) : null}
    </View>
  );
}

function PortfolioState({
  title,
  message,
  action,
}: {
  readonly title: string;
  readonly message: string;
  readonly action?:
    | { readonly label: string; readonly onPress: () => void }
    | undefined;
}) {
  return (
    <AppScreen>
      <View style={styles.stateContainer}>
        <EmptyState
          {...(action === undefined ? {} : { action })}
          message={message}
          title={title}
        />
      </View>
    </AppScreen>
  );
}

function LoadingState({ label }: { readonly label: string }) {
  return (
    <AppScreen>
      <View accessibilityLabel={label} style={styles.loading}>
        <IOSLoader size="large" />
        <Text style={styles.subtitle}>{label}</Text>
      </View>
    </AppScreen>
  );
}

function InlineState({ title, message }: { readonly title: string; readonly message: string }) {
  return (
    <View style={styles.inlineState}>
      <Text accessibilityRole="header" style={styles.positionTitle}>{title}</Text>
      <Text style={styles.subtitle}>{message}</Text>
    </View>
  );
}

function money(amount: Amount): string {
  return `$${formatAmount(amount)}`;
}

function usdt(amount: Amount): string {
  return `${formatAmount(amount)} USDT`;
}

function signedMoney(amount: Amount): string {
  if (amount.baseUnits < 0n) {
    return `-$${formatAmount(amountFromBaseUnits(-amount.baseUnits, amount.decimals))}`;
  }

  return `${amount.baseUnits > 0n ? '+' : ''}$${formatAmount(amount)}`;
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
  },
  stateContainer: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.lg,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.bodyCompact, marginTop: spacing.xxs, color: colors.textSecondary },
  summary: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  positions: { gap: spacing.md },
  positionPanel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  positionHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  positionTitle: { ...typography.heading, color: colors.textPrimary },
  positionSide: { ...typography.bodyCompact, color: colors.accent },
  inlineState: { gap: spacing.sm, paddingVertical: spacing.xl },
  warning: { ...typography.bodyCompact, color: colors.accentSoft },
});
