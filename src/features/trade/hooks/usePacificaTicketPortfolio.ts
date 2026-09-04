import { useEffect, useState } from 'react';

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

export function usePacificaTicketPortfolio(input: {
  readonly account: string | null;
  readonly apiOrigin: string;
  readonly enabled: boolean;
  readonly marketRef: string;
}) {
  const [portfolio, setPortfolio] = useState<PacificaPortfolioSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setPortfolio(null);
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
    update: setPortfolio,
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
