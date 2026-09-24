import { useRef, useState } from 'react';
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
  type PacificaOrderType,
} from '@/integrations/perps/pacifica/pacificaOrder';
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

export type PacificaOrderPhase = 'idle' | 'preparing' | 'prepared' | 'submitting' | 'complete';

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
  const controller = useRef<AbortController | null>(null);

  const reset = () => {
    controller.current?.abort();
    setPlan(null);
    setPreparation(null);
    setFundingRequirement(null);
    setPhase('idle');
  };

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
      if (await input.recovery.reconcile(abort.signal) === 'pending') {
        throw new Error('A previous collateral transaction is still confirming.');
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
        throw new Error('Collateral was signed and is still confirming. Do not submit it again.');
      }
      input.recovery.setPending(false);
      setPreparation(null);
      setPhase('complete');
      setFundingRequirement(null);
      publishInAppNotification({
        kind: 'funding',
        outcome: 'success',
        title: 'Trading collateral confirmed',
        message: 'Pacifica is updating the available trading balance.',
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
    fundingRequirement,
    phase,
    plan,
    prepare,
    preparation,
    reset,
    submitPreparation,
  };
}
