import { Fragment, useState } from 'react';
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
  /**
   * Whether a panel further down has a prepared plan on screen.
   *
   * Owned here because this is where the chrome it hides lives, and reported upward by whichever panel
   * reaches its review. The source cannot change while a review is up — the buttons that would change
   * it are exactly what this withdraws — so there is no state to reconcile when it clears.
   */
  const [reviewing, setReviewing] = useState(false);

  return (
    <View style={withdrawSheetStyles.stack}>
      {/* The sheet's title and its one unavoidable choice, both gone for the duration of a review. The
          review carries its own heading and its own way back, and leaving these above it left the
          reader looking at two headings and a decision that had already been made. */}
      {reviewing ? null : (
        <Fragment>
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
        </Fragment>
      )}

      {source === 'public' ? (
        <DirectWithdrawPanel
          balances={balances}
          mainWalletAddress={session.mainWalletAddress}
          onBalancesChanged={onBalancesChanged}
          onReviewingChange={setReviewing}
          source="public"
        />
      ) : (
        <WithdrawPanel
          balances={balances}
          onBalancesChanged={onBalancesChanged}
          onPacificaRefresh={onPacificaRefresh}
          onReviewingChange={setReviewing}
          reviewing={reviewing}
          snapshot={snapshot}
        />
      )}
    </View>
  );
}
