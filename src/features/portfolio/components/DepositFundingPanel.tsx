import { Fragment, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/ActionButton';
import { PrivateFundingPanel } from '@/features/account/private-funding';
import type { WalletBalances } from '@/features/account/hooks/useWalletBalances';
import { FastPacificaFundingPanel } from '@/features/portfolio/components/FastPacificaFundingPanel';
import {
  WithdrawChoice,
  withdrawOptionStyle,
} from '@/features/portfolio/components/WithdrawChoice';
import {
  WITHDRAW_RADIUS,
  withdrawSheetStyles,
} from '@/features/portfolio/components/withdrawSheetStyles';
import { usePrivateFunding } from '@/integrations/umbra/PrivateFundingProvider';

type FundingRoute = 'fast' | 'private';

/**
 * Chooses how public USDC reaches the same T-keyed Pacifica trading account.
 *
 * Fast is default because it is one atomic transaction and the requested everyday path. Private remains
 * opt-in because it pays for unlinkability with proving/relay time. An unresolved Umbra operation pins
 * the route until its persisted state resolves; switching away would hide the only safe Resume action.
 */
export function DepositFundingPanel({
  balances,
  onBalancesChanged,
  onPacificaRefresh,
  tradingReady,
}: {
  readonly balances: WalletBalances | null;
  readonly onBalancesChanged: () => void;
  readonly onPacificaRefresh: () => void;
  readonly tradingReady: boolean;
}) {
  const privateFunding = usePrivateFunding();
  const [route, setRoute] = useState<FundingRoute>('fast');
  const [fastBusy, setFastBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const privatePending = privateFunding.record !== null &&
    privateFunding.record.phase !== 'complete';
  const routeLocked = privatePending || privateFunding.isRunning || fastBusy;

  useEffect(() => {
    if (privatePending) setRoute('private');
  }, [privatePending]);

  return (
    <View style={withdrawSheetStyles.stack}>
      {reviewing ? null : (
        <Fragment>
          <Text accessibilityRole="header" style={withdrawSheetStyles.title}>Add funds</Text>
          <WithdrawChoice
            label="Route"
            note={route === 'fast'
              ? 'Faster and public on Solana.'
              : 'Umbra obscures the wallet link and takes longer.'}
          >
            <ActionButton
              accessibilityHint="Uses one public, atomic Solana transaction"
              disabled={routeLocked}
              label="Fast"
              onPress={() => setRoute('fast')}
              radius={WITHDRAW_RADIUS}
              selected={route === 'fast'}
              style={withdrawOptionStyle}
              tone={route === 'fast' ? 'accent' : 'neutral'}
            />
            <ActionButton
              accessibilityHint="Uses the slower Umbra privacy route"
              disabled={routeLocked}
              label="Private"
              onPress={() => setRoute('private')}
              radius={WITHDRAW_RADIUS}
              selected={route === 'private'}
              style={withdrawOptionStyle}
              tone={route === 'private' ? 'accent' : 'neutral'}
            />
          </WithdrawChoice>
        </Fragment>
      )}

      {route === 'fast' ? (
        <FastPacificaFundingPanel
          balances={balances}
          onBalancesChanged={onBalancesChanged}
          onBusyChange={setFastBusy}
          onPacificaRefresh={onPacificaRefresh}
          onReviewingChange={setReviewing}
        />
      ) : (
        <PrivateFundingPanel
          balances={balances}
          onBalancesChanged={onBalancesChanged}
          onPacificaRefresh={onPacificaRefresh}
          tradingReady={tradingReady}
        />
      )}
    </View>
  );
}
