import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { Button } from '@/components/ui/Button';
import { StatusRow } from '@/components/ui/StatusRow';
import { BuildTargetBadge } from '@/features/diagnostics/components/BuildTargetBadge';
import { useTradingSession } from '@/integrations/perps/drift/trading-session-provider';
import { useWalletProvisioning } from '@/integrations/privy/useWalletProvisioning';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

/**
 * Readiness surface for the direct Drift prototype. Only live implementation
 * state is shown; price, funding, quote, and order values remain absent until a
 * venue adapter actually supplies sourced and timestamped market data.
 */
export function TradeScreen() {
  const router = useRouter();
  const walletProvisioning = useWalletProvisioning();
  const tradingSession = useTradingSession();

  return (
    <AppScreen>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            Trade
          </Text>
          <Text style={styles.subtitle}>Execution readiness</Text>
        </View>

        <View style={styles.body}>
          <BuildTargetBadge />

          <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.panelTitle}>
              SOL-PERP
            </Text>
            <StatusRow label="Venue" value="Drift devnet" />
            <StatusRow
              label="Drift subscription"
              value={tradingWalletLabel(tradingSession.status)}
            />
            <StatusRow label="Market-data adapter" value="Not implemented" />
            <StatusRow label="Live price" value="Unavailable" />
            <StatusRow label="Funding rate" value="Unavailable" />
            <StatusRow label="Oracle time" value="Unavailable" />
            <Text selectable style={styles.note}>
              The session can subscribe to Drift accounts, but no normalized,
              sourced market-data adapter exposes values to this screen yet.
            </Text>
          </View>

          <View style={styles.panel}>
            <Text accessibilityRole="header" style={styles.panelTitle}>
              Confirmation readiness
            </Text>
            <StatusRow
              label="Privy wallet"
              value={embeddedWalletLabel(walletProvisioning.status)}
            />
            <StatusRow
              label="Trading wallet"
              value={tradingWalletLabel(tradingSession.status)}
            />
            <StatusRow label="Live quote" value="Not implemented" />
            <StatusRow label="Intent verification" value="Not implemented" />
            <StatusRow label="Order submission" value="Blocked" />
            <Text selectable style={styles.note}>
              Before signing, this screen must show side, size, price, leverage,
              collateral, fees, liquidation risk, slippage, and quote expiry.
            </Text>
            <Button
              label="Review wallet session"
              onPress={() => router.navigate('/account')}
              variant="secondary"
            />
          </View>
        </View>
      </View>
    </AppScreen>
  );
}

function embeddedWalletLabel(
  status: ReturnType<typeof useWalletProvisioning>['status'],
): string {
  switch (status) {
    case 'unauthenticated':
      return 'Signed out';
    case 'provisioning':
      return 'Creating or restoring';
    case 'ready':
      return 'Ready';
    case 'needs-recovery':
      return 'Recovery required';
    case 'error':
      return 'Unavailable';
  }
}

function tradingWalletLabel(
  status: ReturnType<typeof useTradingSession>['status'],
): string {
  switch (status) {
    case 'unavailable':
      return 'Waiting for Privy wallet';
    case 'locked':
      return 'Locked';
    case 'unlocking':
      return 'Connecting';
    case 'ready':
      return 'Ready';
    case 'identity-mismatch':
      return 'Identity mismatch';
    case 'error':
      return 'Connection failed';
  }
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
  header: {
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.bodyCompact,
    paddingTop: spacing.xxs,
    color: colors.textSecondary,
  },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  panelTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  note: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
});
