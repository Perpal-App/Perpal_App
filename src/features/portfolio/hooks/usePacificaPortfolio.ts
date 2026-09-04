import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PacificaApiError } from '@/integrations/perps/pacifica/pacificaApi';
import {
  fetchPacificaPortfolio,
  type PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';

type PortfolioState = 'idle' | 'loading' | 'ready' | 'error' | 'stale';
const REFRESH_INTERVAL_MS = 5_000;
const MAX_RETRY_INTERVAL_MS = 30_000;

export function usePacificaPortfolio(apiOrigin: string, walletAddress: string | null) {
  const [snapshot, setSnapshot] = useState<PacificaPortfolioSnapshot | null>(null);
  const [status, setStatus] = useState<PortfolioState>('idle');
  const [refreshKey, setRefreshKey] = useState(0);
  const hasSnapshot = useRef(false);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

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
        const next = await fetchPacificaPortfolio(apiOrigin, walletAddress, controller.signal);
        if (active) {
          consecutiveFailures = 0;
          hasSnapshot.current = true;
          setSnapshot(next);
          setStatus('ready');
        }
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          consecutiveFailures += 1;
          nextRefreshMs = retryInterval(consecutiveFailures);
          if (__DEV__) {
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
          setStatus(hasSnapshot.current ? 'stale' : 'error');
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

function retryInterval(attempt: number): number {
  const exponential = Math.min(
    MAX_RETRY_INTERVAL_MS,
    REFRESH_INTERVAL_MS * (2 ** Math.min(attempt - 1, 3)),
  );
  return Math.round(exponential * (0.8 + Math.random() * 0.4));
}
