import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/layout/AppScreen';
import { StatusRow } from '@/components/ui/StatusRow';
import { formatDetailedUsd } from '@/domain/money/amount';
import type {
  FlashPortfolioPosition,
  FlashPortfolioSnapshot,
} from '@/integrations/perps/flash/flashPortfolio';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';

export function FlashPortfolioContent({
  snapshot,
  walletAddress,
}: {
  readonly snapshot: FlashPortfolioSnapshot;
  readonly walletAddress: string | null;
}) {
  return (
    <AppScreen>
      <View style={styles.container}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>
            Portfolio
          </Text>
          <Text style={styles.subtitle}>Flash Trade v2 · Solana mainnet</Text>
        </View>

        <View style={styles.summary}>
          <StatusRow label="Trading wallet" value={shortAddress(walletAddress)} />
          <StatusRow label="Flash basket" value={shortAddress(snapshot.accountAddress)} />
          <StatusRow label="Open orders" value={snapshot.openOrders.toString()} />
          <StatusRow label="ER slot" value={snapshot.slot.toLocaleString()} />
        </View>

        {!snapshot.initialized ? (
          <InlineState
            title="Flash account not initialized"
            message="No Flash basket exists for this trading wallet. Basket creation belongs to the explicit funding or first-trade flow."
          />
        ) : snapshot.positions.length === 0 ? (
          <InlineState
            title="No open positions"
            message="This Flash basket is live and currently has no open perpetual position."
          />
        ) : (
          <View style={styles.positions}>
            {snapshot.positions.map((position) => (
              <PositionPanel
                key={`${position.marketAddress}:${position.side}`}
                position={position}
              />
            ))}
          </View>
        )}
      </View>
    </AppScreen>
  );
}

function PositionPanel({
  position,
}: {
  readonly position: FlashPortfolioPosition;
}) {
  return (
    <View style={styles.positionPanel}>
      <View style={styles.positionHeader}>
        <Text accessibilityRole="header" style={styles.positionTitle}>
          {position.symbol}
        </Text>
        <Text style={styles.positionSide}>{position.side}</Text>
      </View>
      <StatusRow label="Size" value={groupDecimal(position.size)} />
      <StatusRow label="Entry price" value={`$${groupDecimal(position.entryPrice)}`} />
      <StatusRow label="Notional" value={formatDetailedUsd(position.notional)} />
      <StatusRow
        label="Collateral"
        value={`${formatDetailedUsd(position.collateral)} · ${position.collateralSymbol}`}
      />
      <StatusRow
        label="Leverage"
        value={position.leverage === null ? 'Unavailable' : `${position.leverage}×`}
      />
      <StatusRow label="Risk source" value="Flash ER account" />
    </View>
  );
}

function InlineState({
  title,
  message,
}: {
  readonly title: string;
  readonly message: string;
}) {
  return (
    <View style={styles.inlineState}>
      <Text accessibilityRole="header" style={styles.positionTitle}>{title}</Text>
      <Text style={styles.subtitle}>{message}</Text>
    </View>
  );
}

function groupDecimal(value: string): string {
  const [whole = '0', fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function shortAddress(address: string | null): string {
  return address === null ? '—' : `${address.slice(0, 4)}…${address.slice(-4)}`;
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
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: {
    ...typography.bodyCompact,
    marginTop: spacing.xxs,
    color: colors.textSecondary,
  },
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
});
