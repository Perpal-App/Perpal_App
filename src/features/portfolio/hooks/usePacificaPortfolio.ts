import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isPacificaRateLimited,
  pacificaRetryDelay,
  PacificaApiError,
} from '@/integrations/perps/pacifica/pacificaApi';
import {
  fetchFreshPacificaPortfolio,
  fetchPacificaPortfolio,
  type PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';

type PortfolioState = 'idle' | 'loading' | 'ready' | 'error' | 'stale';
const REFRESH_INTERVAL_MS = 5_000;
const MAX_RETRY_INTERVAL_MS = 60_000;

export function usePacificaPortfolio(apiOrigin: string, walletAddress: string | null) {
  const [snapshot, setSnapshot] = useState<PacificaPortfolioSnapshot | null>(null);
  const [status, setStatus] = useState<PortfolioState>('idle');
  const [refreshKey, setRefreshKey] = useState(0);
  const hasSnapshot = useRef(false);
  const forceNetwork = useRef(false);
  const refresh = useCallback(() => {
    forceNetwork.current = true;
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    hasSnapshot.current = false;
    setSnapshot(null);
    setStatus(walletAddress === null ? 'idle' : 'loading');
  }, [apiOrigin, walletAddress]);

  useFocusEffect(useCallback(() => {
    if (walletAddress === null || apiOrigin.length === 0) return undefined;
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      let nextRefreshMs = REFRESH_INTERVAL_MS;
      if (!hasSnapshot.current) setStatus('loading');
      try {
        const network = forceNetwork.current;
        forceNetwork.current = false;
        const next = await (network ? fetchFreshPacificaPortfolio : fetchPacificaPortfolio)(
          apiOrigin,
          walletAddress,
          controller.signal,
        );
        if (active) {
          consecutiveFailures = 0;
          hasSnapshot.current = true;
          setSnapshot(next);
          setStatus('ready');
        }
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          consecutiveFailures += 1;
          nextRefreshMs = pacificaRetryDelay(
            cause,
            consecutiveFailures,
            REFRESH_INTERVAL_MS,
            MAX_RETRY_INTERVAL_MS,
          );
          if (__DEV__ && !isPacificaRateLimited(cause)) {
            console.warn('[Perpal Pacifica portfolio refresh failed]',
              cause instanceof PacificaApiError
                ? {
                    errorCode: cause.code,
                    errorName: cause.name,
                    requestPath: cause.requestPath,
                    status: cause.status,
                  }
                : { errorName: cause instanceof Error ? cause.name : typeof cause },
            );
          }
          setStatus(hasSnapshot.current ? 'stale' : 'loading');
        }
      } finally {
        if (active) timer = setTimeout(() => void load(), nextRefreshMs);
      }
    };
    void load();
    return () => {
      active = false;
      controller?.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [apiOrigin, refreshKey, walletAddress]));

  return { snapshot, status, refresh };
}
