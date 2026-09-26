import { useCallback, useEffect, useRef, useState } from 'react';

import { parseAmount } from '@/domain/money/amount';
import { orderSubmissionNotification } from '@/features/trade/components/PacificaOrderTicketFormatting';
import { logTradeError } from '@/integrations/observability/tradeError';
import { fetchPacificaMarketBundle } from '@/integrations/perps/pacifica/pacificaMarketData';
import {
  PacificaCommandPendingError,
  preparePacificaOrder,
  submitPacificaOrder,
  type PacificaOrderPlan,
} from '@/integrations/perps/pacifica/pacificaOrder';
import type { PacificaPosition } from '@/integrations/perps/pacifica/pacificaPortfolio';
import { refreshPacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolioStore';
import { showAppToast } from '@/storage/appToast';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
} from '@/storage/inAppNotifications';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

/** Sizes are compared at the venue's ten places. */
const SIZE_DECIMALS = 10;

/** Which position a close is for: one market, one side. */
export function positionKey(position: Pick<PacificaPosition, 'side' | 'symbol'>): string {
  return `${position.symbol}:${position.side}`;
}

/**
 * Closes an open position by hand, in one tap: the whole position, at market, reduce-only.
 *
 * The tap is the confirmation. It comes from a card that shows the position — its side, its size, its entry
 * and mark — and a button that says Close, so there is no dialog after it. What stands in for the dialog is
 * a check before signing: the market and the account are read afresh, the close is priced by the order
 * builder, and the plan is sent only if it closes the same side and exactly the size the reader was shown.
 * If the position has changed since it was drawn, nothing is sent and the reader is told.
 *
 * Reduce-only, so the order can close the position and never open one the other way. Submission re-checks
 * the quote's expiry and the live price against the slippage limit before anything is sent.
 *
 * One close at a time, held synchronously, so a second tap on any position's button cannot start another.
 */
export function usePacificaPositionClose(input: {
  readonly apiOrigin: string;
  readonly assetOrigin: string;
  /** After any close attempt ends, for a screen that keeps its own account read beside the shared one. */
  readonly onSettled?: () => void;
}) {
  const session = useTradingSession();
  const { apiOrigin, assetOrigin, onSettled } = input;
  const [closing, setClosing] = useState<string | null>(null);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const close = useCallback(async (shown: PacificaPosition) => {
    const account = session.status === 'ready' ? session.address : null;
    const signer = session.signer;
    if (account === null || signer === null || inFlight.current) return;
    inFlight.current = true;
    setClosing(positionKey(shown));
    const abort = new AbortController();
    controller.current = abort;
    const scopeToken = captureInAppNotificationScope();
    let plan: PacificaOrderPlan | null = null;
    let baseAsset = shown.symbol;

    try {
      const prepared = await prepareClose({ account, apiOrigin, assetOrigin, position: shown, signal: abort.signal });
      if (abort.signal.aborted) return;
      if (prepared === null) {
        showAppToast({ outcome: 'info', message: `${shown.symbol} ${shown.side} is already closed.` });
        return;
      }
      baseAsset = prepared.baseAsset;
      if (!closesWhatWasShown(prepared.plan, shown)) {
        showAppToast({
          outcome: 'info',
          message: `${baseAsset} ${shown.side} changed since it was shown. Nothing was sent; check it and close again.`,
        });
        return;
      }

      plan = prepared.plan;
      const result = await submitPacificaOrder({
        account,
        apiOrigin,
        intentStartedAtMs: performance.now(),
        plan,
        signer,
      });
      publishInAppNotification({
        correlations: [{ namespace: 'pacifica-order', value: plan.clientOrderId }],
        ...orderSubmissionNotification(plan, baseAsset, result.orderStatus),
        scopeToken,
      });
    } catch (cause) {
      if (abort.signal.aborted) return;
      if (plan === null) {
        // Nothing was sent: the close could not be priced.
        logTradeError('pacifica', 'preparation', cause);
        showAppToast({
          outcome: 'error',
          message: cause instanceof Error ? cause.message : `${baseAsset} close could not be prepared.`,
        });
        return;
      }
      const pending = cause instanceof PacificaCommandPendingError;
      if (!pending) logTradeError('pacifica', 'submission', cause);
      publishInAppNotification({
        correlations: [{ namespace: 'pacifica-order', value: plan.clientOrderId }],
        kind: 'trade',
        message: cause instanceof Error ? cause.message : `${baseAsset} position was not closed.`,
        outcome: pending ? 'info' : 'error',
        scopeToken,
        status: pending ? 'submitted' : 'failed',
        title: pending ? 'Close status pending' : 'Position not closed',
      });
    } finally {
      inFlight.current = false;
      if (!abort.signal.aborted) {
        setClosing(null);
        void refreshPacificaPortfolioSnapshot({ account, apiOrigin, forceNetwork: true }).catch(() => undefined);
        onSettled?.();
      }
    }
  }, [apiOrigin, assetOrigin, onSettled, session]);

  return {
    close: (position: PacificaPosition) => void close(position),
    /** The key of the position being closed, from `positionKey`, or `null`. */
    closing,
  };
}

/**
 * One screen's close control. A screen with more than one way to close a position — a card and the
 * chart — shares one, so the one-at-a-time guard and the busy state cover all of them.
 */
export type PositionCloser = ReturnType<typeof usePacificaPositionClose>;

/**
 * The plan closes exactly what the reader was shown: the same market and side, reduce-only, at market, for
 * the size on the card. A position that grew, shrank or flipped since it was drawn fails this.
 */
function closesWhatWasShown(plan: PacificaOrderPlan, shown: PacificaPosition): boolean {
  try {
    return plan.action === 'close' &&
      plan.reduceOnly &&
      plan.orderType === 'market' &&
      plan.symbol === shown.symbol &&
      plan.side === shown.side &&
      parseAmount(plan.amount, SIZE_DECIMALS).baseUnits === absolute(parseAmount(shown.amount, SIZE_DECIMALS).baseUnits);
  } catch {
    return false;
  }
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * The close as the order builder prices it now, or `null` when the venue no longer reports the position.
 * Market and account are read afresh, together, for any market — the position need not be on the screen's.
 */
async function prepareClose(input: {
  readonly account: string;
  readonly apiOrigin: string;
  readonly assetOrigin: string;
  readonly position: PacificaPosition;
  readonly signal: AbortSignal;
}): Promise<{ readonly baseAsset: string; readonly plan: PacificaOrderPlan } | null> {
  const { account, apiOrigin, position, signal } = input;
  const [bundle, portfolio] = await Promise.all([
    fetchPacificaMarketBundle(apiOrigin, input.assetOrigin, signal),
    refreshPacificaPortfolioSnapshot({ account, apiOrigin, forceNetwork: true, signal }),
  ]);
  const market = bundle.markets.find((candidate) => candidate.venueRef === position.symbol);
  const snapshot = bundle.snapshots.find((candidate) => candidate.venueRef === position.symbol);
  if (market === undefined || snapshot === undefined) {
    throw new Error(`${position.symbol} market data is unavailable. Try again.`);
  }
  const current = portfolio.positions.find(
    (candidate) => candidate.symbol === position.symbol && candidate.side === position.side,
  );
  if (current === undefined) return null;

  const plan = await preparePacificaOrder({
    account,
    action: 'close',
    apiOrigin,
    collateralBaseUnits: 0n,
    leverage: 1,
    marginMode: current.marginMode,
    market,
    orderPrice: undefined,
    orderType: 'market',
    portfolio,
    side: position.side,
    signal,
    snapshot,
    triggerPrice: undefined,
  });
  return { baseAsset: market.baseAsset, plan };
}
