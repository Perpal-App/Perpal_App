import { useEffect, useLayoutEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { readAppConfig } from '@/config/appConfig';
import {
  isPacificaRateLimited,
  pacificaRetryDelay,
} from '@/integrations/perps/pacifica/pacificaApi';
import {
  fetchPacificaActivity,
  type PacificaBalanceActivity,
  type PacificaTradeActivity,
} from '@/integrations/perps/pacifica/pacificaActivity';
import {
  clearPacificaActivitySnapshot,
  markPacificaActivityUnavailable,
  publishPacificaActivitySnapshot,
} from '@/integrations/perps/pacifica/pacificaActivityStore';
import {
  pacificaLifecycleEventKey,
  pacificaLifecycleScope,
  readPacificaLifecycleCheckpoint,
  writePacificaLifecycleCheckpoint,
  type PacificaLifecycleCheckpoint,
} from '@/integrations/perps/pacifica/pacificaLifecycleCheckpoint';
import {
  fetchPacificaPortfolio,
  type PacificaOpenOrder,
  type PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';
import { clearPacificaReadCache } from '@/integrations/perps/pacifica/pacificaReadCoordinator';
import {
  captureInAppNotificationScope,
  publishInAppNotification,
  readInAppNotificationStatus,
  setInAppNotificationScope,
  type InAppNotificationCorrelation,
  type InAppNotificationScopeToken,
} from '@/storage/inAppNotifications';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

const REFRESH_INTERVAL_MS = 5_000;
const MAX_RETRY_INTERVAL_MS = 30_000;
const BACKFILL_AFTER_MS = 60_000;

/**
 * Reconciles the Pacifica account independently of whichever screen is visible.
 *
 * React Native cannot guarantee JavaScript execution after the OS suspends the app. This monitor
 * therefore polls only while active, aborts immediately on identity/config/background changes,
 * and performs an authoritative catch-up as soon as the app returns to the foreground. It does
 * not claim to replace server-backed push notifications.
 */
export function PacificaAccountLifecycleMonitor() {
  const session = useTradingSession();
  const config = readAppConfig();
  const ownerAddress = session.mainWalletAddress;
  const account = session.status === 'ready' ? session.address : null;
  const apiOrigin = config.ok ? config.value.perps.pacificaApiOrigin : '';
  const network = config.ok ? config.value.cluster : null;

  useLayoutEffect(() => {
    setInAppNotificationScope(ownerAddress === null || network === null
      ? null
      : { network, ownerAddress });
    return () => setInAppNotificationScope(null);
  }, [network, ownerAddress]);

  useEffect(() => {
    if (
      account === null ||
      ownerAddress === null ||
      network === null ||
      apiOrigin.length === 0
    ) return undefined;

    const scope = pacificaLifecycleScope({ account, network, ownerAddress });
    const notificationScope = captureInAppNotificationScope();
    let checkpoint = readPacificaLifecycleCheckpoint(scope);
    let previousPortfolio: PacificaPortfolioSnapshot | null = null;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = AppState.currentState === 'active';
    let disposed = false;
    let failures = 0;
    let needsBackfill = checkpoint === null ||
      Date.now() - checkpoint.updatedAtMs > BACKFILL_AFTER_MS;

    const stopPending = () => {
      controller?.abort();
      controller = null;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    const schedule = (delayMs: number) => {
      if (disposed || !active) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), delayMs);
    };

    const refresh = async () => {
      if (disposed || !active) return;
      stopPending();
      const request = new AbortController();
      controller = request;
      let activityFailed = false;

      try {
        const mode = needsBackfill ? 'backfill' : 'latest';
        const [portfolioResult, activityResult] = await Promise.allSettled([
          fetchPacificaPortfolio(apiOrigin, account, request.signal),
          fetchPacificaActivity(apiOrigin, account, request.signal, mode),
        ]);
        if (disposed || request.signal.aborted || controller !== request) return;
        if (activityResult.status === 'fulfilled') {
          publishPacificaActivitySnapshot({
            account,
            activity: activityResult.value,
            apiOrigin,
          });
        } else {
          activityFailed = true;
          throw activityResult.reason;
        }
        if (portfolioResult.status === 'rejected') throw portfolioResult.reason;

        const activity = activityResult.value;
        const portfolio = portfolioResult.value;

        if (checkpoint === null) {
          // A partial first read cannot establish which feed is empty and which failed. Wait for
          // one complete baseline instead of replaying old history as new notifications.
          if (!activity.incomplete) {
            checkpoint = checkpointFromActivity(activity.trades, activity.balances);
            writePacificaLifecycleCheckpoint(scope, checkpoint);
            needsBackfill = false;
          }
        } else {
          const previousCheckpoint = checkpoint;
          const newTrades = unseenTrades(activity.trades, checkpoint.tradeKeys);
          const newBalances = unseenBalances(activity.balances, checkpoint.balanceKeys);

          for (const trade of chronological(newTrades)) publishTrade(trade, notificationScope);
          for (const balance of chronological(newBalances)) {
            publishBalance(balance, notificationScope);
          }
          reconcilePortfolio(previousPortfolio, portfolio, newTrades, notificationScope);

          const merged = mergeCheckpoint(previousCheckpoint, activity.trades, activity.balances);
          checkpoint = activity.incomplete
            ? { ...merged, updatedAtMs: previousCheckpoint.updatedAtMs }
            : merged;
          if (!activity.incomplete) writePacificaLifecycleCheckpoint(scope, checkpoint);
          needsBackfill = activity.incomplete;
        }
        previousPortfolio = portfolio;
        failures = activity.incomplete ? failures + 1 : 0;
        schedule(activity.incomplete
          ? pacificaRetryDelay(
              null,
              failures,
              REFRESH_INTERVAL_MS,
              MAX_RETRY_INTERVAL_MS,
            )
          : REFRESH_INTERVAL_MS);
      } catch (cause) {
        if (disposed || request.signal.aborted || controller !== request) return;
        failures += 1;
        if (activityFailed) {
          markPacificaActivityUnavailable({
            account,
            apiOrigin,
            rateLimited: isPacificaRateLimited(cause),
          });
        }
        // No account identifiers or provider payloads are logged here. The visible screen keeps
        // its last authoritative snapshot while the bounded retry loop recovers.
        if (__DEV__ && !isPacificaRateLimited(cause)) {
          console.warn('[Perpal Pacifica lifecycle refresh failed]', {
            errorName: cause instanceof Error ? cause.name : typeof cause,
          });
        }
        schedule(pacificaRetryDelay(
          cause,
          failures,
          REFRESH_INTERVAL_MS,
          MAX_RETRY_INTERVAL_MS,
        ));
      } finally {
        if (controller === request) controller = null;
      }
    };

    const onAppState = (state: AppStateStatus) => {
      active = state === 'active';
      if (!active) {
        stopPending();
        return;
      }
      needsBackfill = checkpoint === null ||
        Date.now() - checkpoint.updatedAtMs > BACKFILL_AFTER_MS;
      void refresh();
    };

    const subscription = AppState.addEventListener('change', onAppState);
    if (active) void refresh();

    return () => {
      disposed = true;
      active = false;
      stopPending();
      clearPacificaReadCache();
      clearPacificaActivitySnapshot(apiOrigin, account);
      subscription.remove();
    };
  }, [account, apiOrigin, network, ownerAddress]);

  return null;
}

function checkpointFromActivity(
  trades: readonly PacificaTradeActivity[],
  balances: readonly PacificaBalanceActivity[],
): PacificaLifecycleCheckpoint {
  return {
    balanceKeys: balances.map(balanceEventKey),
    tradeKeys: trades.map(tradeEventKey),
    updatedAtMs: Date.now(),
    version: 1,
  };
}

function mergeCheckpoint(
  previous: PacificaLifecycleCheckpoint,
  trades: readonly PacificaTradeActivity[],
  balances: readonly PacificaBalanceActivity[],
): PacificaLifecycleCheckpoint {
  return {
    balanceKeys: unique([...balances.map(balanceEventKey), ...previous.balanceKeys]),
    tradeKeys: unique([...trades.map(tradeEventKey), ...previous.tradeKeys]),
    updatedAtMs: Date.now(),
    version: 1,
  };
}

function unseenTrades(
  trades: readonly PacificaTradeActivity[],
  seen: readonly string[],
): readonly PacificaTradeActivity[] {
  const known = new Set(seen);
  return trades.filter((item) => !known.has(tradeEventKey(item)));
}

function unseenBalances(
  balances: readonly PacificaBalanceActivity[],
  seen: readonly string[],
): readonly PacificaBalanceActivity[] {
  const known = new Set(seen);
  return balances.filter((item) => !known.has(balanceEventKey(item)));
}

function tradeEventKey(item: PacificaTradeActivity): string {
  return pacificaLifecycleEventKey('trade', String(item.historyId));
}

function balanceEventKey(item: PacificaBalanceActivity): string {
  return pacificaLifecycleEventKey('balance', balanceEventId(item));
}

function balanceEventId(item: PacificaBalanceActivity): string {
  return `${item.createdAtMs}:${item.eventType}:${item.amount}:${item.balance}`;
}

function publishTrade(
  trade: PacificaTradeActivity,
  scopeToken: InAppNotificationScopeToken | null,
): void {
  const direction = trade.side.endsWith('long') ? 'long' : 'short';
  const opening = trade.side.startsWith('open');
  const correlation: InAppNotificationCorrelation = {
    namespace: 'pacifica-trade',
    value: String(trade.historyId),
  };

  if (trade.cause === 'market_liquidation' || trade.cause === 'backstop_liquidation') {
    publishInAppNotification({
      correlations: [correlation], kind: 'trade', outcome: 'error', status: 'liquidated',
      scopeToken,
      title: `${trade.symbol} liquidated`,
      message: `Pacifica confirmed the ${direction} position liquidation.`,
    });
    return;
  }
  if (trade.cause === 'settlement') {
    publishInAppNotification({
      correlations: [correlation], kind: 'trade', outcome: 'info', status: 'settled',
      scopeToken,
      title: `${trade.symbol} settled`,
      message: `Pacifica confirmed settlement of the ${direction} position.`,
    });
    return;
  }
  publishInAppNotification({
    correlations: [correlation], kind: 'trade', outcome: 'success', status: 'filled',
    scopeToken,
    title: `${trade.symbol} ${opening ? 'open' : 'close'} filled`,
    message: `Pacifica filled the ${direction} ${opening ? 'open' : 'close'} order.`,
  });
}

function publishBalance(
  item: PacificaBalanceActivity,
  scopeToken: InAppNotificationScopeToken | null,
): void {
  const correlation: InAppNotificationCorrelation = {
    namespace: 'pacifica-balance',
    value: balanceEventId(item),
  };
  if (item.eventType === 'withdraw' ||
    (item.eventType === 'subaccount_transfer' && item.amount.startsWith('-'))) {
    publishInAppNotification({
      correlations: [correlation], kind: 'withdrawal', outcome: 'success', status: 'settled',
      scopeToken,
      title: 'Trading withdrawal settled',
      message: 'Pacifica confirmed the trading-account withdrawal.',
    });
    return;
  }
  if (item.eventType === 'deposit' || item.eventType === 'deposit_release') {
    publishInAppNotification({
      correlations: [correlation], kind: 'funding', outcome: 'success', status: 'settled',
      scopeToken,
      title: item.eventType === 'deposit' ? 'Trading deposit confirmed' : 'Trading funds available',
      message: 'Pacifica confirmed the trading-account balance update.',
    });
    return;
  }
  if (item.eventType === 'funding' || item.eventType === 'payout' ||
    item.eventType === 'subaccount_transfer') {
    publishInAppNotification({
      correlations: [correlation], kind: 'funding', outcome: 'info', status: 'settled',
      scopeToken,
      title: item.eventType === 'funding' ? 'Funding payment settled' : 'Trading balance updated',
      message: 'Pacifica confirmed the account balance event.',
    });
    return;
  }
  if (['trade', 'market_liquidation', 'backstop_liquidation', 'adl_liquidation']
    .includes(item.eventType)) return;
  publishInAppNotification({
    correlations: [correlation], kind: 'funding', outcome: 'info', status: 'settled',
    scopeToken,
    title: 'Trading balance updated',
    message: 'Pacifica confirmed an account balance change.',
  });
}

function reconcilePortfolio(
  previous: PacificaPortfolioSnapshot | null,
  current: PacificaPortfolioSnapshot,
  newTrades: readonly PacificaTradeActivity[],
  scopeToken: InAppNotificationScopeToken | null,
): void {
  if (previous === null) return;
  const tradesBySymbol = new Set(newTrades.map((trade) => trade.symbol));
  const currentOrders = new Set(current.orders.map((order) => String(order.orderId)));

  for (const order of current.orders) {
    if (!previous.orders.some((item) => item.orderId === order.orderId)) {
      publishOpenOrder(order, scopeToken);
    }
  }
  for (const order of previous.orders) {
    if (!currentOrders.has(String(order.orderId)) && !tradesBySymbol.has(order.symbol)) {
      const correlation = orderCorrelations(order)[0];
      const localStatus = correlation === undefined
        ? null
        : readInAppNotificationStatus(correlation);
      publishInAppNotification({
        correlations: orderCorrelations(order),
        kind: 'trade',
        outcome: localStatus === 'submitted' || localStatus === 'cancelled' ? 'success' : 'info',
        scopeToken,
        status: localStatus === 'submitted' || localStatus === 'cancelled' ? 'cancelled' : 'confirmed',
        title: `${order.symbol} order ${localStatus === 'submitted' || localStatus === 'cancelled'
          ? 'cancelled'
          : 'closed'}`,
        message: localStatus === 'submitted' || localStatus === 'cancelled'
          ? 'Pacifica no longer reports the cancelled order as open.'
          : 'Pacifica no longer reports this order as open.',
      });
    }
  }

  const previousPositions = positionFingerprint(previous);
  const currentPositions = positionFingerprint(current);
  if (previousPositions !== currentPositions && newTrades.length === 0) {
    publishInAppNotification({
      correlations: [{ namespace: 'pacifica-trade', value: `position:${currentPositions}` }],
      kind: 'trade', outcome: 'info', status: 'confirmed', title: 'Position updated',
      scopeToken,
      message: 'Pacifica reported a position change. Review the current size and risk.',
    });
  }
}

function publishOpenOrder(
  order: PacificaOpenOrder,
  scopeToken: InAppNotificationScopeToken | null,
): void {
  publishInAppNotification({
    correlations: orderCorrelations(order), kind: 'trade', outcome: 'info', status: 'accepted',
    scopeToken,
    title: `${order.symbol} order open`,
    message: 'Pacifica now reports this order in the open-order book.',
  });
}

function orderCorrelations(order: PacificaOpenOrder): readonly InAppNotificationCorrelation[] {
  return [
    { namespace: 'pacifica-order', value: String(order.orderId) },
    ...(order.clientOrderId === null
      ? []
      : [{ namespace: 'pacifica-order' as const, value: order.clientOrderId }]),
  ];
}

function positionFingerprint(snapshot: PacificaPortfolioSnapshot): string {
  return [...snapshot.positions]
    .sort((left, right) => `${left.symbol}:${left.side}`.localeCompare(`${right.symbol}:${right.side}`))
    .map((item) => [item.symbol, item.side, item.amount, item.entryPrice].join(':'))
    .join('|');
}

function chronological<T extends { readonly createdAtMs: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.createdAtMs - right.createdAtMs);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
