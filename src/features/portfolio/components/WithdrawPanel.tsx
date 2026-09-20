import { useState } from 'react';
import { View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { DirectWithdrawPanel } from '@/features/portfolio/components/DirectWithdrawPanel';
import { PacificaPendingReleaseCard } from '@/features/portfolio/components/PacificaPendingReleaseCard';
import { PrivateWithdrawPanel } from '@/features/portfolio/components/PrivateWithdrawPanel';
import {
  WithdrawChoice,
  withdrawOptionStyle,
} from '@/features/portfolio/components/WithdrawChoice';
import {
  WITHDRAW_RADIUS,
  withdrawSheetStyles,
} from '@/features/portfolio/components/withdrawSheetStyles';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

/**
 * How the money leaves: straight out on Solana, or privately through Umbra.
 *
 * This is the one choice in the sheet that keeps a sentence. Which route is observable on-chain is a
 * privacy claim, and leaving the reader to infer it from the word "Private" would be overstating what
 * the other option does. What went is the mechanics that followed it — the one-time account rent and
 * the network fees — because those are amounts, and amounts belong on the review step that already
 * itemises them rather than as a warning in front of a button that has not been pressed.
 */
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
    <View style={withdrawSheetStyles.stack}>
      <WithdrawChoice
        label="Route"
        note={route === 'direct'
          ? 'Visible on Solana.'
          : 'Routed privately through Umbra.'}
      >
        <ActionButton
          accessibilityHint="Sends directly from your private balance without Umbra"
          label="Direct"
          onPress={() => setRoute('direct')}
          radius={WITHDRAW_RADIUS}
          selected={route === 'direct'}
          style={withdrawOptionStyle}
          tone={route === 'direct' ? 'accent' : 'neutral'}
        />
        <ActionButton
          accessibilityHint="Routes the withdrawal privately through Umbra"
          label="Private"
          onPress={() => setRoute('private')}
          radius={WITHDRAW_RADIUS}
          selected={route === 'private'}
          style={withdrawOptionStyle}
          tone={route === 'private' ? 'accent' : 'neutral'}
        />
      </WithdrawChoice>

      {route === 'direct' ? (
        <View style={withdrawSheetStyles.stack}>
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
