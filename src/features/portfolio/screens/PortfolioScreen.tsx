import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/feedback/EmptyState';
import { IOSLoader } from '@/components/feedback/IOSLoader';
import { AppScreen } from '@/components/layout/AppScreen';
import { StatusRow } from '@/components/ui/StatusRow';
import { readAppConfig } from '@/config/appConfig';
import { amountFromBaseUnits, formatAmount, type Amount } from '@/domain/money/amount';
import { useDriftPortfolio } from '@/features/portfolio/hooks/useDriftPortfolio';
import { useDriftVenueMarkets } from '@/features/trade/hooks/useDriftVenueMarkets';
import { usePublicMarkets } from '@/features/trade/hooks/usePublicMarkets';
import type {
  DriftPortfolioPosition,
  DriftPortfolioSnapshot,
} from '@/integrations/perps/drift/driftPortfolio';
import type { DriftMarketSnapshot } from '@/integrations/perps/drift/driftMarketData';
import { listMainnetMarkets } from '@/integrations/perps/markets/mainnetCatalog';
import { useAppPreferences } from '@/storage/AppPreferencesProvider';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function PortfolioScreen() {
  const router = useRouter();
  const config = readAppConfig();
  const preferences = useAppPreferences();
  const session = useTradingSession();
  const isDriftReady =
    preferences.selectedPerpsProvider === 'drift' && session.status === 'ready';
  const markets = useMemo(() => listMainnetMarkets('drift'), []);
  const publicMarkets = usePublicMarkets(
    config.ok ? config.value.api.marketDataUrl : '',
    config.ok ? config.value.api.marketStreamUrl : '',
    isDriftReady,
  );
  const venueMarkets = useDriftVenueMarkets(
    isDriftReady ? 'drift' : 'flash',
    config.ok ? config.value.api.publicRpcUrl : '',
    config.ok ? config.value.perps.driftProgramId : '',
    markets,
    publicMarkets.prices,
  );
  const portfolio = useDriftPortfolio(
    config.ok ? config.value.api.publicRpcUrl : '',
    config.ok ? config.value.perps.driftProgramId : '',
    isDriftReady ? session.address : null,
    markets,
    publicMarkets.prices,
  );

  if (preferences.selectedPerpsProvider === 'flash') {
    return (
      <PortfolioState
        title="Flash portfolio unavailable"
        message="Flash account data requires the production ER endpoint supplied by Flash. Select Drift in Markets to use the connected mainnet path."
      />
    );
  }

  if (!config.ok) {
    return (
      <PortfolioState
        title="Configuration required"
        message="The mainnet gateway or Drift program configuration is invalid."
      />
    );
  }

  if (session.status === 'waiting-for-wallet') {
    return (
      <PortfolioState
        title="Privy wallet required"
        message="Privy could not create the embedded Solana wallet. Open Account to retry after enabling it in the Privy app configuration."
        action={{
          label: 'Open account setup',
          onPress: () => router.push('/(tabs)/account'),
        }}
      />
    );
  }

  if (session.status === 'unlocking') {
    return <LoadingState label="Waiting for wallet signature" />;
  }

  if (session.status !== 'ready') {
    return (
      <PortfolioState
        title={
          session.status === 'recovery-required'
            ? 'Trading wallet recovery required'
            : 'Unlock your portfolio'
        }
        message={
          session.status === 'recovery-required'
            ? 'The derived trading wallet does not match the recorded identity. No new identity was adopted.'
            : 'One Privy message signature unlocks the deterministic trading wallet for this app session. It does not submit a transaction.'
        }
        action={
          session.status === 'recovery-required'
            ? undefined
            : {
                label: 'Unlock trading wallet',
                onPress: () => void session.unlock(),
              }
        }
      />
    );
  }

  if (portfolio.status === 'loading' || portfolio.snapshot === null) {
    return <LoadingState label="Loading Drift portfolio" />;
  }

  if (portfolio.status === 'error') {
    return (
      <PortfolioState
        title="Portfolio unavailable"
        message="The Drift account could not be read. The app will retry while this tab remains open."
      />
    );
  }

  return (
    <PortfolioContent
      snapshot={portfolio.snapshot}
      venues={venueMarkets.snapshots}
      walletAddress={session.address}
    />
  );
}

function PortfolioContent({
  snapshot,
  venues,
  walletAddress,
}: {
  readonly snapshot: DriftPortfolioSnapshot;
  readonly venues: readonly DriftMarketSnapshot[];
  readonly walletAddress: string | null;
}) {
  const venueBySymbol = new Map(venues.map((venue) => [venue.symbol, venue]));

  return (
    <AppScreen>
      <View style={styles.container}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>
            Portfolio
          </Text>
          <Text style={styles.subtitle}>Drift · Solana mainnet</Text>
        </View>

        <View style={styles.summary}>
          <StatusRow label="Trading wallet" value={shortAddress(walletAddress)} />
          <StatusRow label="Drift account" value={shortAddress(snapshot.accountAddress)} />
          <StatusRow label="Open orders" value={snapshot.openOrders.toString()} />
          <StatusRow label="Account slot" value={snapshot.slot.toLocaleString()} />
        </View>

        {!snapshot.initialized ? (
          <InlineState
            title="Drift account not initialized"
            message="No Drift user account exists for this trading wallet. Account creation belongs to the explicit funding or first-trade flow."
          />
        ) : snapshot.positions.length === 0 ? (
          <InlineState
            title="No open positions"
            message="This Drift account is live and currently has no core perpetual position."
          />
        ) : (
          <View style={styles.positions}>
            {snapshot.positions.map((position) => (
              <PositionPanel
                key={position.symbol}
                position={position}
                venue={venueBySymbol.get(position.symbol) ?? null}
              />
            ))}
          </View>
        )}

        {snapshot.unsupportedPositionCount > 0 ? (
          <Text accessibilityRole="alert" style={styles.warning}>
            {snapshot.unsupportedPositionCount} non-core Drift position is not yet
            rendered. It has not been included in the values above.
          </Text>
        ) : null}
      </View>
    </AppScreen>
  );
}

function PositionPanel({
  position,
  venue,
}: {
  readonly position: DriftPortfolioPosition;
  readonly venue: DriftMarketSnapshot | null;
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
        label="Initial margin"
        value={venue === null ? 'Loading venue risk' : money(initialMargin(position, venue))}
      />
      <StatusRow label="Open orders" value={position.openOrders.toString()} />
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

function initialMargin(
  position: DriftPortfolioPosition,
  venue: DriftMarketSnapshot,
): Amount {
  const notional =
    (position.size.baseUnits * venue.markPrice.baseUnits) / 1_000_000_000n;
  return amountFromBaseUnits(
    (notional * BigInt(venue.initialMarginBps)) / 10_000n,
    6,
  );
}

function shortAddress(address: string | null): string {
  return address === null ? '—' : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function money(amount: Amount): string {
  return `$${formatAmount(amount)}`;
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
