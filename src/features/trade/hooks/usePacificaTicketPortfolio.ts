import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  reconcilePendingPacificaCommand,
  type PacificaCommandReconciliation,
} from '@/integrations/perps/pacifica/pacificaOrderReconciliation';
import type { PacificaPortfolioSnapshot } from '@/integrations/perps/pacifica/pacificaPortfolio';
import {
  publishPacificaPortfolioSnapshot,
  readPacificaPortfolioSnapshot,
  refreshPacificaPortfolioSnapshot,
  subscribePacificaPortfolioSnapshot,
  type PacificaPortfolioStoreSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolioStore';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
  type InAppNotificationScopeToken,
} from '@/storage/inAppNotifications';

const EMPTY: PacificaPortfolioStoreSnapshot = {
  data: null,
  status: 'loading',
  updatedAtMs: 0,
};

/**
 * Market-ticket adapter over the same Pacifica account snapshot used by Portfolio and Home.
 *
 * The removed module cache was the reason a newly opened market could render the old zero after a
 * deposit had already appeared elsewhere. A fresh read on open still protects decision freshness, but
 * it now publishes into one account-keyed store, so a mounted ticket also changes the instant any other
 * owner observes the credit.
 */
export function usePacificaTicketPortfolio(input: {
  readonly account: string | null;
  readonly apiOrigin: string;
  readonly enabled: boolean;
}) {
  const subscribe = useCallback((listener: () => void) => (
    input.account === null || input.apiOrigin.length === 0
      ? () => undefined
      : subscribePacificaPortfolioSnapshot(input.apiOrigin, input.account, listener)
  ), [input.account, input.apiOrigin]);
  const read = useCallback(() => (
    input.account === null || input.apiOrigin.length === 0
      ? EMPTY
      : readPacificaPortfolioSnapshot(input.apiOrigin, input.account)
  ), [input.account, input.apiOrigin]);
  const state = useSyncExternalStore(subscribe, read, read);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!input.enabled || input.account === null || input.apiOrigin.length === 0) {
      setChecking(false);
      return undefined;
    }
    setChecking(true);
    const account = input.account;
    const abort = new AbortController();
    const scopeToken = captureInAppNotificationScope();

    // Account display and command recovery are independent. Starting them together means a long
    // paginated recovery scan cannot hold the current balance behind it; order submission remains
    // separately guarded by the command/recovery owners.
    void refreshPacificaPortfolioSnapshot({
      account,
      apiOrigin: input.apiOrigin,
      forceNetwork: true,
      signal: abort.signal,
    }).catch(() => undefined).finally(() => {
      if (!abort.signal.aborted) setChecking(false);
    });

    void reconcilePendingPacificaCommand({
      account,
      apiOrigin: input.apiOrigin,
      signal: abort.signal,
    }).then((recovery) => {
      if (!abort.signal.aborted && recovery.status !== 'none') {
        publishRecovery(recovery, scopeToken);
      }
    }).catch((cause) => {
      if (!abort.signal.aborted && __DEV__) {
        console.warn('[Perpal Pacifica command recovery failed]', {
          error: cause instanceof Error ? cause.message : typeof cause,
        });
      }
    });

    return () => abort.abort();
  }, [input.account, input.apiOrigin, input.enabled]);

  const refresh = useCallback(() => {
    if (input.account === null || input.apiOrigin.length === 0) return;
    void refreshPacificaPortfolioSnapshot({
      account: input.account,
      apiOrigin: input.apiOrigin,
      forceNetwork: true,
    }).catch(() => undefined);
  }, [input.account, input.apiOrigin]);

  const update = useCallback((next: PacificaPortfolioSnapshot) => {
    if (input.account === null) return;
    publishPacificaPortfolioSnapshot({
      account: input.account,
      apiOrigin: input.apiOrigin,
      snapshot: next,
    });
  }, [input.account, input.apiOrigin]);

  return {
    checking,
    failed: state.status === 'error',
    portfolio: state.data,
    refresh,
    update,
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
