import { useState } from 'react';
import { Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { DirectWithdrawPanel } from '@/features/portfolio/components/DirectWithdrawPanel';
import {
  WithdrawChoice,
  withdrawOptionStyle,
} from '@/features/portfolio/components/WithdrawChoice';
import { WithdrawPanel } from '@/features/portfolio/components/WithdrawPanel';
import {
  WITHDRAW_RADIUS,
  withdrawSheetStyles,
} from '@/features/portfolio/components/withdrawSheetStyles';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

type Source = 'private' | 'public';

/**
 * The withdraw sheet's outermost decision: which balance the money is coming out of.
 *
 * It owns the sheet's only title. "Choose where the funds are held." came off it — a sentence
 * explaining a two-button choice whose buttons already read "Public wallet" and "Private funds", set
 * directly above them at the same size as the paragraph the next panel down also opened with.
 */
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
    <View style={withdrawSheetStyles.stack}>
      <Text accessibilityRole="header" style={withdrawSheetStyles.title}>Withdraw</Text>

      <WithdrawChoice label="From">
        {(['public', 'private'] as const).map((value) => (
          <ActionButton
            key={value}
            label={value === 'public' ? 'Public wallet' : 'Private funds'}
            onPress={() => setSource(value)}
            radius={WITHDRAW_RADIUS}
            selected={source === value}
            style={withdrawOptionStyle}
            tone={source === value ? 'accent' : 'neutral'}
          />
        ))}
      </WithdrawChoice>

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
