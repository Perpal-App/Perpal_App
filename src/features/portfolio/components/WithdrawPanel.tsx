import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { DirectWithdrawPanel } from '@/features/portfolio/components/DirectWithdrawPanel';
import { PacificaPendingReleaseCard } from '@/features/portfolio/components/PacificaPendingReleaseCard';
import { PrivateWithdrawPanel } from '@/features/portfolio/components/PrivateWithdrawPanel';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { colors, spacing, typography } from '@/theme/tokens';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function WithdrawPanel({
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
  const [route, setRoute] = useState<'direct' | 'private'>('direct');

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>Withdrawal route</Text>
        <Text style={styles.note}>
          Direct sends visibly on Solana. Private uses Umbra and may require one-time account rent and network fees.
        </Text>
      </View>
      <View accessibilityRole="radiogroup" style={styles.routes}>
        <ActionButton
          accessibilityHint="Sends directly from your private balance without Umbra"
          label="Direct"
          onPress={() => setRoute('direct')}
          selected={route === 'direct'}
          style={styles.route}
          tone={route === 'direct' ? 'accent' : 'neutral'}
        />
        <ActionButton
          accessibilityHint="Routes the withdrawal privately through Umbra"
          label="Private"
          onPress={() => setRoute('private')}
          selected={route === 'private'}
          style={styles.route}
          tone={route === 'private' ? 'accent' : 'neutral'}
        />
      </View>
      {route === 'direct' ? (
        <View style={styles.direct}>
          <PacificaPendingReleaseCard
            onBalancesChanged={onBalancesChanged}
            onPacificaRefresh={onPacificaRefresh}
          />
          <DirectWithdrawPanel
            balances={balances}
            mainWalletAddress={session.mainWalletAddress}
            onBalancesChanged={onBalancesChanged}
            onPacificaRefresh={onPacificaRefresh}
            snapshot={snapshot}
          />
        </View>
      ) : (
        <PrivateWithdrawPanel balances={balances} snapshot={snapshot} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: spacing.xs },
  title: { ...typography.heading, color: colors.textPrimary },
  note: { ...typography.bodyCompact, color: colors.textSecondary },
  routes: { flexDirection: 'row', gap: spacing.sm },
  route: { flex: 1 },
  direct: { gap: spacing.lg },
});
