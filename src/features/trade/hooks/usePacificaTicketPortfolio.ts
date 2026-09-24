import { useCallback, useEffect, useState } from 'react';

import {
  reconcilePendingPacificaCommand,
  type PacificaCommandReconciliation,
} from '@/integrations/perps/pacifica/pacificaOrderReconciliation';
import {
  fetchPacificaPortfolio,
  type PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
  type InAppNotificationScopeToken,
} from '@/storage/inAppNotifications';

/**
 * The last snapshot read, so a remount has something to render on its first frame.
 *
 * The ticket is mounted inside a sheet that unmounts on close, so every open used to restart at `null`
 * and hold a skeleton until the venue answered — and then, one frame after the answer, replace the
 * controls it had just drawn once the wallet balance arrived too.
 *
 * Safe to render because it is only ever rendered. `usePacificaOrderFlow.prepare` calls
 * `fetchFreshPacificaPortfolio` and passes *that* to `preparePacificaOrder`, so no order is ever priced
 * against this value; it fills a card while the live one is in flight.
 *
 * One entry carrying its own account, so it cannot be read for a different identity and a rotation
 * replaces it rather than accumulating. In memory only.
 */
let cached: { readonly account: string; readonly value: PacificaPortfolioSnapshot } | null = null;

function readCache(account: string | null): PacificaPortfolioSnapshot | null {
  return account !== null && cached?.account === account ? cached.value : null;
}

export function usePacificaTicketPortfolio(input: {
  readonly account: string | null;
  readonly apiOrigin: string;
  readonly enabled: boolean;
  readonly marketRef: string;
}) {
  const [portfolio, setPortfolio] = useState<PacificaPortfolioSnapshot | null>(
    () => readCache(input.account),
  );
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  const publish = useCallback((next: PacificaPortfolioSnapshot) => {
    if (input.account !== null) cached = { account: input.account, value: next };
    setPortfolio(next);
  }, [input.account]);

  useEffect(() => {
    // The cached snapshot rather than nothing, so a reopen shows the last known state while the refresh
    // runs instead of starting from a skeleton it already had the answer for.
    setPortfolio(readCache(input.account));
    setFailed(false);
    if (!input.enabled || input.account === null) return;
    const account = input.account;
    const abort = new AbortController();
    const scopeToken = captureInAppNotificationScope();
    const load = async () => {
      try {
        const recovery = await reconcilePendingPacificaCommand({
          account,
          apiOrigin: input.apiOrigin,
          signal: abort.signal,
        });
        if (!abort.signal.aborted && recovery.status !== 'none') {
          publishRecovery(recovery, scopeToken);
        }
      } catch (cause) {
        if (!abort.signal.aborted && __DEV__) {
          console.warn('[Perpal Pacifica command recovery failed]', {
            error: cause instanceof Error ? cause.message : typeof cause,
          });
        }
      }
      const next = await fetchPacificaPortfolio(input.apiOrigin, account, abort.signal);
      cached = { account, value: next };
      if (!abort.signal.aborted) setPortfolio(next);
    };
    void load().catch(() => {
      if (!abort.signal.aborted) setFailed(true);
    });
    return () => abort.abort();
  }, [input.account, input.apiOrigin, input.enabled, input.marketRef, revision]);

  return {
    failed,
    portfolio,
    refresh: () => setRevision((value) => value + 1),
    // `publish`, not `setPortfolio`: the flow hands back the fresh snapshot it fetched before pricing an
    // order, which is the most current one the app will see. Dropping it on the floor would leave the
    // next open seeding from something older than what was just in hand.
    update: publish,
  };
}

function publishRecovery(
  result: Exclude<PacificaCommandReconciliation, { readonly status: 'none' }>,
  scopeToken: InAppNotificationScopeToken | null,
): void {
  if (result.status === 'pending') {
    publishInAppNotification({
      kind: 'trade',
      message: 'Pacifica is reconciling a previous signed command. Do not submit it again.',
      outcome: 'info',
      scopeToken,
      status: 'submitted',
      title: 'Trade status pending',
    });
    return;
  }
  if (result.status === 'review_required') {
    publishInAppNotification({
      kind: 'trade',
      message: 'No order was sent. Refresh the quote and review the order again.',
      outcome: 'info',
      scopeToken,
      status: 'cancelled',
      title: 'Order review required',
    });
    return;
  }
  const correlations = result.kind === 'create'
    ? [{ namespace: 'pacifica-order' as const, value: result.clientOrderId }]
    : [{ namespace: 'pacifica-order' as const, value: String(result.orderId) }];
  const cancelled = result.orderStatus === 'cancelled';
  const rejected = result.orderStatus === 'rejected';
  publishInAppNotification({
    correlations,
    kind: 'trade',
    message: result.kind === 'cancel'
      ? `Order ${result.orderId} is ${result.orderStatus.replace('_', ' ')} on Pacifica.`
      : `The recovered Pacifica order is ${result.orderStatus.replace('_', ' ')}.`,
    outcome: rejected ? 'error' : cancelled ? 'info' : 'success',
    scopeToken,
    status: result.orderStatus === 'open' || result.orderStatus === 'partially_filled'
      ? 'accepted'
      : result.orderStatus === 'rejected'
        ? 'failed'
        : result.orderStatus,
    title: result.kind === 'cancel' && cancelled
      ? 'Order cancelled'
      : rejected
        ? 'Order rejected'
        : 'Order status recovered',
  });
}
