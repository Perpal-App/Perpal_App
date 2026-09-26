import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { AmountError, parseAmount } from '@/domain/money/amount';
import {
  orderConfirmation,
  orderSubmissionNotification,
} from '@/features/trade/components/PacificaOrderTicketFormatting';
import type { usePacificaTicketPortfolio } from '@/features/trade/hooks/usePacificaTicketPortfolio';
import type { useTradeActionRecovery } from '@/features/trade/hooks/useTradeActionRecovery';
import { logTradeError } from '@/integrations/observability/tradeError';
import type {
  PacificaMarket,
  PacificaMarketSnapshot,
} from '@/integrations/perps/pacifica/pacificaMarketData';
import {
  preparePacificaOrder,
  PacificaCommandPendingError,
  PacificaOrderValidationError,
  submitPacificaOrder,
  validatePacificaOrderDraft,
  type PacificaMarginMode,
  type PacificaOrderAction,
  type PacificaOrderPlan,
  type PacificaOrderSide,
  type PacificaOrderSubmission,
  type PacificaOrderType,
} from '@/integrations/perps/pacifica/pacificaOrder';
import { waitForPacificaDepositCredit } from '@/integrations/perps/pacifica/pacificaDepositSettlement';
import { fetchFreshPacificaPortfolio } from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  preparePacificaTradeCollateral,
  submitTradeCollateralStep,
  TradeFundingRequirementError,
  type TradeCollateralStep,
  type TradeFundingRequirement,
} from '@/integrations/perps/tradeCollateral';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
} from '@/storage/inAppNotifications';
import { showAppToast } from '@/storage/appToast';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export type PacificaOrderPhase =
  | 'idle'
  | 'preparing'
  | 'prepared'
  | 'submitting'
  | 'indexing';

/**
 * An order the venue has taken, kept only long enough to tell the reader about it.
 *
 * Deliberately not a `phase`. The phases describe work in progress, and this describes work that is
 * finished — the machine is back at `idle` the moment it is set, so the ticket is free to price another
 * order while the confirmation is still on screen. Folding it into the union would have meant a state
 * the form had to treat as busy when it is not.
 *
 * It carries the plan by value because the plan it describes is gone: `submit` clears `plan` on the way
 * through, which is correct — a plan is a priced, signable intent and holding a stale one alive is how a
 * second signature ends up bound to the first one's quote. This is a receipt, not a plan.
 */
export type PacificaOrderPlaced = {
  readonly orderId: number;
  readonly orderStatus: PacificaOrderSubmission['orderStatus'];
  readonly plan: PacificaOrderPlan;
};

/**
 * Everything the reader typed, as one value.
 *
 * The ticket holds these as eleven separate `useState` calls and hands them over on each render. They
 * are grouped here rather than there because this hook is the only thing that reads all of them at
 * once, and a single named shape is what lets `prepare` stay a readable list of validations.
 */
export type PacificaOrderDraft = {
  readonly action: PacificaOrderAction;
  readonly collateral: string;
  readonly leverage: string;
  readonly limitPrice: string;
  readonly marginMode: PacificaMarginMode;
  readonly orderType: PacificaOrderType;
  readonly side: PacificaOrderSide;
  readonly stopLoss: string;
  readonly takeProfit: string;
  readonly tpSlEnabled: boolean;
  readonly triggerPrice: string;
};

/** The venue coordinates the flow needs, which are build configuration rather than user input. */
export type PacificaOrderVenue = {
  readonly apiOrigin: string;
  readonly centralState: string;
  readonly programId: string;
  readonly rpcUrl: string;
  readonly usdcMint: string;
  readonly vault: string;
};

/**
 * Everything between a filled-in ticket and a submitted order.
 *
 * Split out of `PacificaOrderTicket`, which had reached the file-size ceiling with the form and the
 * flow in one place. The seam is deliberate rather than convenient: the component owns what the reader
 * typed, and this owns what is done with it. Nothing in here renders, and nothing in the component
 * awaits.
 *
 * `submit` is intentionally not returned. The only path to a signature is `confirm`, which puts the
 * plan in front of the reader and calls `submit` from the dialog's own action — keeping that private
 * means a future caller cannot reach signing without the confirmation, whatever it renders.
 *
 * Two invariants moved across unchanged and both matter:
 *
 * - `reset` aborts the in-flight request and drops any prepared plan. Every draft edit in the
 *   component calls it, so a plan can never outlive the inputs it was priced for.
 * - A prepared plan is handed to `submit` by value. The object confirmed is the object signed, and the
 *   lifecycle re-verifies the live price against it rather than against anything on screen.
 */
export function usePacificaOrderFlow(input: {
  readonly draft: PacificaOrderDraft;
  readonly fundingOnly: boolean;
  readonly market: PacificaMarket;
  readonly portfolioState: ReturnType<typeof usePacificaTicketPortfolio>;
  readonly recovery: ReturnType<typeof useTradeActionRecovery>;
  readonly snapshot: PacificaMarketSnapshot;
  readonly venue: PacificaOrderVenue;
}) {
  const session = useTradingSession();
  const [phase, setPhase] = useState<PacificaOrderPhase>('idle');
  const [plan, setPlan] = useState<PacificaOrderPlan | null>(null);
  const [preparation, setPreparation] = useState<TradeCollateralStep | null>(null);
  const [fundingRequirement, setFundingRequirement] = useState<TradeFundingRequirement | null>(null);
  const [placed, setPlaced] = useState<PacificaOrderPlaced | null>(null);
  const controller = useRef<AbortController | null>(null);

  const reset = () => {
    controller.current?.abort();
    setPlan(null);
    setPreparation(null);
    setFundingRequirement(null);
    // A receipt belongs to the market and identity it was signed under. The ticket calls this on every
    // draft edit and on a market or wallet change, and a confirmation for the instrument the reader just
    // navigated away from would be describing an order they can no longer see.
    setPlaced(null);
    setPhase('idle');
  };

  // A shared portfolio publication can turn the ticket into its normal trading form while this hook is
  // still carrying the local indexing label. Once funding-only is false, that label has done its job.
  useEffect(() => {
    if (!input.fundingOnly && phase === 'indexing') setPhase('idle');
  }, [input.fundingOnly, phase]);

  const abortPending = () => controller.current?.abort();

  const prepare = async () => {
    const { draft, market, snapshot, venue } = input;
    if (session.address === null || session.signer === null) {
      session.retryRestore();
      return;
    }
    try {
      if (input.fundingOnly) {
        const amount = parseAmount(draft.collateral, 6).baseUnits;
        if (amount <= 0n) throw new AmountError('Enter a deposit greater than zero.');
      } else {
        validatePacificaOrderDraft({
          action: draft.action,
          collateral: draft.collateral,
          leverage: draft.leverage,
          market,
          orderPrice: draft.limitPrice,
          orderType: draft.orderType,
          side: draft.side,
          snapshot,
          stopLossPrice: draft.stopLoss,
          takeProfitPrice: draft.takeProfit,
          tpSlEnabled: draft.tpSlEnabled,
          triggerPrice: draft.triggerPrice,
        });
      }
    } catch (cause) {
      showAppToast({
        outcome: 'error',
        message: cause instanceof Error ? cause.message : 'Review the order inputs.',
      });
      return;
    }
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setPhase('preparing');
    setPlan(null);
    setPreparation(null);
    setFundingRequirement(null);
    try {
      const recoveryStatus = await input.recovery.reconcile(abort.signal);
      if (recoveryStatus === 'pending' || recoveryStatus === 'indexing') {
        throw new Error(recoveryStatus === 'indexing'
          ? 'Pacifica is crediting the previous deposit.'
          : 'A previous collateral transaction is still confirming.');
      }
      const collateralBaseUnits = draft.action === 'open'
        ? parseAmount(draft.collateral, 6).baseUnits
        : 0n;
      if (draft.action === 'open') {
        const next = await preparePacificaTradeCollateral({
          apiOrigin: venue.apiOrigin,
          centralState: venue.centralState,
          owner: session.address,
          programId: venue.programId,
          requiredBaseUnits: collateralBaseUnits,
          rpcUrl: venue.rpcUrl,
          signal: abort.signal,
          signer: session.signer,
          usdcMint: venue.usdcMint,
          vault: venue.vault,
        });
        if (next !== null) {
          setPreparation(next);
          setPhase('prepared');
          return;
        }
        if (input.fundingOnly) {
          throw new Error('Pacifica already has available trading balance. Refresh the ticket.');
        }
      }
      const latestPortfolio = await fetchFreshPacificaPortfolio(
        venue.apiOrigin,
        session.address,
        abort.signal,
      );
      input.portfolioState.update(latestPortfolio);
      const nextPlan = await preparePacificaOrder({
        account: session.address,
        action: draft.action,
        apiOrigin: venue.apiOrigin,
        collateralBaseUnits,
        leverage: draft.action === 'open' ? Number(draft.leverage) : 1,
        marginMode: draft.marginMode,
        market,
        orderPrice: draft.limitPrice,
        orderType: draft.orderType,
        portfolio: latestPortfolio,
        side: draft.side,
        snapshot,
        signal: abort.signal,
        ...(draft.tpSlEnabled
          ? { stopLossPrice: draft.stopLoss, takeProfitPrice: draft.takeProfit }
          : {}),
        triggerPrice: draft.triggerPrice,
      });
      if (!abort.signal.aborted) {
        setPlan(nextPlan);
        setPhase('prepared');
      }
    } catch (cause) {
      if (!abort.signal.aborted) {
        if (cause instanceof TradeFundingRequirementError) {
          setFundingRequirement(cause.requirement);
        } else if (cause instanceof AmountError || cause instanceof PacificaOrderValidationError) {
          showAppToast({ outcome: 'error', message: cause.message });
        } else {
          logTradeError('pacifica', 'preparation', cause);
          showAppToast({
            outcome: 'error',
            message: cause instanceof Error ? cause.message : 'Pacifica order preview failed.',
          });
        }
        setPhase('idle');
      }
    }
  };

  const submitPreparation = async () => {
    if (preparation === null || session.address === null || session.signer === null) return;
    const scopeToken = captureInAppNotificationScope();
    const abort = new AbortController();
    controller.current = abort;
    setPhase('submitting');
    try {
      const result = await submitTradeCollateralStep({
        owner: session.address,
        rpcUrl: input.venue.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
        step: preparation,
      });
      if (result.status !== 'confirmed') {
        input.recovery.setPending(true);
        setPreparation(null);
        setPhase('indexing');
        publishInAppNotification({
          kind: 'funding',
          outcome: 'info',
          title: 'Collateral submitted',
          message: 'Waiting for Solana and Pacifica. Do not submit it again.',
          scopeToken,
        });
        return;
      }

      // Solana confirmation does not mean the venue API has indexed the credit. Keep the durable
      // collateral record and the non-actionable ticket state until a forced account read proves the
      // exact balance increase; the shared store updates every mounted and future ticket together.
      setPreparation(null);
      setPhase('indexing');
      const settlement = await waitForPacificaDepositCredit({
        account: session.address,
        apiOrigin: input.venue.apiOrigin,
        rpcUrl: input.venue.rpcUrl,
        signal: abort.signal,
        signer: session.signer,
      });
      if (settlement.status !== 'credited') {
        input.recovery.setPending(true);
        publishInAppNotification({
          kind: 'funding',
          outcome: 'info',
          title: 'Pacifica is crediting collateral',
          message: 'The transfer confirmed. Trading balance is still syncing.',
          scopeToken,
        });
        return;
      }

      input.recovery.setPending(false);
      if (settlement.snapshot !== null) input.portfolioState.update(settlement.snapshot);
      setPhase('idle');
      setFundingRequirement(null);
      publishInAppNotification({
        kind: 'funding',
        outcome: 'success',
        title: 'Trading collateral ready',
        message: 'USDC is available for trading.',
        scopeToken,
      });
    } catch (cause) {
      if (!abort.signal.aborted) {
        logTradeError('pacifica', 'submission', cause);
        setPhase('idle');
        publishInAppNotification({
          kind: 'funding',
          outcome: 'error',
          title: 'Trading collateral not confirmed',
          message: cause instanceof Error ? cause.message : 'Review the collateral step.',
          scopeToken,
        });
      }
    }
  };

  const submit = async (confirmed: PacificaOrderPlan) => {
    if (session.address === null || session.signer === null) return;
    const scopeToken = captureInAppNotificationScope();
    setPhase('submitting');
    try {
      const result = await submitPacificaOrder({
        account: session.address,
        apiOrigin: input.venue.apiOrigin,
        intentStartedAtMs: performance.now(),
        plan: confirmed,
        signer: session.signer,
      });
      setPlan(null);
      setPhase('idle');
      // Only for a status that is actually good news. A rejection and a cancellation both come back
      // through this branch rather than as a thrown error — the request succeeded, the order did not —
      // and a green tick over either would be the screen telling the reader something untrue. Those two
      // are already reported honestly by the notification below, which reads `rejected` as an error.
      if (result.orderStatus !== 'rejected' && result.orderStatus !== 'cancelled') {
        setPlaced({ orderId: result.orderId, orderStatus: result.orderStatus, plan: confirmed });
      }
      input.portfolioState.refresh();
      publishInAppNotification({
        correlations: [{ namespace: 'pacifica-order', value: confirmed.clientOrderId }],
        ...orderSubmissionNotification(confirmed, input.market.baseAsset, result.orderStatus),
        scopeToken,
      });
    } catch (cause) {
      if (!(cause instanceof PacificaCommandPendingError)) {
        logTradeError('pacifica', 'submission', cause);
      }
      setPlan(null);
      setPhase('idle');
      publishInAppNotification({
        correlations: [{ namespace: 'pacifica-order', value: confirmed.clientOrderId }],
        kind: 'trade',
        outcome: cause instanceof PacificaCommandPendingError ? 'info' : 'error',
        status: cause instanceof PacificaCommandPendingError ? 'submitted' : 'failed',
        title: cause instanceof PacificaCommandPendingError
          ? 'Order status pending'
          : 'Order needs review',
        message: cause instanceof Error
          ? cause.message
          : `${input.market.baseAsset} order needs review.`,
        scopeToken,
      });
    }
  };

  const confirm = () => {
    if (plan === null) return;
    const copy = orderConfirmation(plan, input.market.baseAsset);
    Alert.alert(copy.title, copy.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm and sign', onPress: () => void submit(plan) },
    ]);
  };

  return {
    abortPending,
    confirm,
    /** Clears the receipt. Called when the confirmation has finished leaving, not when it starts. */
    dismissPlaced: () => setPlaced(null),
    fundingRequirement,
    phase,
    placed,
    plan,
    prepare,
    preparation,
    reset,
    submitPreparation,
  };
}
