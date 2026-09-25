import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import {
  readPacificaPortfolioSnapshot,
  refreshPacificaPortfolioSnapshot,
  subscribePacificaPortfolioSnapshot,
  type PacificaPortfolioStoreSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolioStore';

const IDLE: PacificaPortfolioStoreSnapshot = {
  data: null,
  status: 'loading',
  updatedAtMs: 0,
};

/**
 * Screen adapter for the account snapshot owned by the root Pacifica monitor.
 *
 * Portfolio and Home used to run independent five-second loops while market tickets had a third module
 * cache. A deposit could therefore be visible in one place and zero in another. All consumers now read
 * the same external-store object; Retry performs one forced network read and publishes it to all of them.
 */
export function usePacificaPortfolio(apiOrigin: string, walletAddress: string | null) {
  const request = useRef<AbortController | null>(null);
  const subscribe = useCallback((listener: () => void) => (
    walletAddress === null || apiOrigin.length === 0
      ? () => undefined
      : subscribePacificaPortfolioSnapshot(apiOrigin, walletAddress, listener)
  ), [apiOrigin, walletAddress]);
  const read = useCallback(() => (
    walletAddress === null || apiOrigin.length === 0
      ? IDLE
      : readPacificaPortfolioSnapshot(apiOrigin, walletAddress)
  ), [apiOrigin, walletAddress]);
  const state = useSyncExternalStore(subscribe, read, read);

  useEffect(() => () => request.current?.abort(), [apiOrigin, walletAddress]);

  const refresh = useCallback(() => {
    if (walletAddress === null || apiOrigin.length === 0) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    void refreshPacificaPortfolioSnapshot({
      account: walletAddress,
      apiOrigin,
      forceNetwork: true,
      signal: controller.signal,
    }).catch(() => undefined).finally(() => {
      if (request.current === controller) request.current = null;
    });
  }, [apiOrigin, walletAddress]);

  return {
    refresh,
    snapshot: state.data,
    status: walletAddress === null ? 'idle' as const : state.status,
  };
}
