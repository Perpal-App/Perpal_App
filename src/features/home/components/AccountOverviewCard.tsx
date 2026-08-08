import { StyleSheet, Text, View } from 'react-native';

import { SkeletonText } from '@/components/feedback/Skeleton';
import {
  addAmounts,
  amountFromBaseUnits,
  formatDetailedUsd,
  isNegativeAmount,
  isZeroAmount,
  parseAmount,
  subtractAmounts,
  type Amount,
} from '@/domain/money/amount';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, radii, spacing, typography } from '@/theme/tokens';

export function AccountOverviewCard({
  balances,
  balancesPending,
  portfolio,
  portfolioPending,
}: {
  readonly balances: WalletBalances | null;
  readonly balancesPending: boolean;
  readonly portfolio: PacificaPortfolioSnapshot | null;
  readonly portfolioPending: boolean;
}) {
  const publicBalance = walletStablecoins(balances?.publicWallet ?? null);
  const privateBalance = privateFunds(balances, portfolio);
  const pnl = unrealizedPnl(portfolio);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Metric
          caption="USDC + USDT in Privy M"
          label="Public balance"
          pending={balancesPending}
          value={money(publicBalance)}
        />
        <View style={styles.verticalRule} />
        <Metric
          caption="Stablecoins in T + Pacifica"
          label="Private balance"
          pending={balancesPending || portfolioPending}
          value={money(privateBalance)}
        />
      </View>
      <View style={styles.horizontalRule} />
      <View style={styles.row}>
        <Metric
          caption="Open positions"
          label="Unrealized PnL"
          pending={portfolioPending}
          tone={pnl === null || isZeroAmount(pnl)
            ? 'neutral'
            : isNegativeAmount(pnl)
              ? 'negative'
              : 'positive'}
          value={money(pnl)}
        />
        <View style={styles.verticalRule} />
        <Metric
          caption={portfolio === null
            ? 'Pacifica positions'
            : `${portfolio.orders.length} open ${portfolio.orders.length === 1 ? 'order' : 'orders'}`}
          label="Active trades"
          pending={portfolioPending}
          value={portfolio === null ? null : String(portfolio.positions.length)}
        />
      </View>
    </View>
  );
}

function Metric({
  caption,
  label,
  pending,
  tone = 'neutral',
  value,
}: {
  readonly caption: string;
  readonly label: string;
  readonly pending: boolean;
  readonly tone?: 'negative' | 'neutral' | 'positive';
  readonly value: string | null;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.label}>{label}</Text>
      {pending && value === null ? (
        <View style={styles.skeleton}><SkeletonText role="heading" width={92} /></View>
      ) : (
        <Text
          accessibilityLiveRegion="polite"
          selectable
          style={[
            styles.value,
            tone === 'positive' && styles.positive,
            tone === 'negative' && styles.negative,
          ]}
        >
          {value ?? 'Unavailable'}
        </Text>
      )}
      <Text style={styles.caption}>{caption}</Text>
    </View>
  );
}

function walletStablecoins(
  wallet: WalletBalances['publicWallet'] | null,
): Amount | null {
  return wallet === null
    ? null
    : amountFromBaseUnits(wallet.usdcBaseUnits + wallet.usdtBaseUnits, 6);
}

function privateFunds(
  balances: WalletBalances | null,
  portfolio: PacificaPortfolioSnapshot | null,
): Amount | null {
  if (balances === null || portfolio === null) return null;

  try {
    return addAmounts(
      walletStablecoins(balances.privateWallet)!,
      parseAmount(portfolio.accountEquity, 6),
    );
  } catch {
    return null;
  }
}

function unrealizedPnl(portfolio: PacificaPortfolioSnapshot | null): Amount | null {
  if (portfolio === null) return null;

  try {
    return subtractAmounts(
      parseAmount(portfolio.accountEquity, 6),
      parseAmount(portfolio.balance, 6),
    );
  } catch {
    return null;
  }
}

function money(value: Amount | null): string | null {
  return value === null ? null : formatDetailedUsd(value);
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  row: { minHeight: 112, flexDirection: 'row', alignItems: 'stretch' },
  metric: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: spacing.xxs,
    padding: spacing.md,
  },
  label: { ...typography.caption, color: colors.textSecondary },
  value: { ...typography.heading, fontVariant: ['tabular-nums'], color: colors.textPrimary },
  caption: { ...typography.eyebrow, color: colors.textMuted },
  positive: { color: colors.positive },
  negative: { color: colors.negative },
  skeleton: { minHeight: 29, justifyContent: 'center' },
  verticalRule: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  horizontalRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
