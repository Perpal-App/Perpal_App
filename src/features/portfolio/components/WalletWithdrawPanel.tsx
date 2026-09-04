import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { DirectWithdrawPanel } from '@/features/portfolio/components/DirectWithdrawPanel';
import { WithdrawPanel } from '@/features/portfolio/components/WithdrawPanel';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Source = 'private' | 'public';

export function WalletWithdrawPanel({
  balances,
  onBalancesChanged,
  onPacificaRefresh,
  snapshot,
}: {
  readonly balances: WalletBalances | null;
  readonly onBalancesChanged: () => void;
  readonly onPacificaRefresh: () => void;
  readonly snapshot: PacificaPortfolioSnapshot | null;
}) {
  const session = useTradingSession();
  const [source, setSource] = useState<Source>('public');

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>Withdraw</Text>
        <Text style={styles.note}>Choose where the funds are held.</Text>
      </View>

      <View accessibilityRole="radiogroup" style={styles.sources}>
        {(['public', 'private'] as const).map((value) => (
          <ActionButton
            key={value}
            label={value === 'public' ? 'Public wallet' : 'Private funds'}
            onPress={() => setSource(value)}
            selected={source === value}
            style={styles.source}
            tone={source === value ? 'accent' : 'neutral'}
          />
        ))}
      </View>

      {source === 'public' ? (
        <DirectWithdrawPanel
          balances={balances}
          mainWalletAddress={session.mainWalletAddress}
          onBalancesChanged={onBalancesChanged}
          source="public"
        />
      ) : (
        <WithdrawPanel
          balances={balances}
          onBalancesChanged={onBalancesChanged}
          onPacificaRefresh={onPacificaRefresh}
          snapshot={snapshot}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: 2 },
  title: { ...typography.heading, color: colors.textPrimary },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
  sources: { flexDirection: 'row', gap: spacing.sm },
  source: { flex: 1, minWidth: 0 },
});
