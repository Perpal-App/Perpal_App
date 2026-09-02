import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchPacificaPortfolio,
  type PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';

type PortfolioState = 'idle' | 'loading' | 'ready' | 'error' | 'stale';
const REFRESH_INTERVAL_MS = 5_000;

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
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      if (!hasSnapshot.current) setStatus('loading');
      try {
        const next = await fetchPacificaPortfolio(apiOrigin, walletAddress, controller.signal);
        if (active) {
          hasSnapshot.current = true;
          setSnapshot(next);
          setStatus('ready');
        }
      } catch (cause) {
        if (active && !controller.signal.aborted) {
          if (__DEV__) console.error('[Perpal Pacifica portfolio failed]', { error: cause instanceof Error ? cause.message : typeof cause });
          setStatus(hasSnapshot.current ? 'stale' : 'error');
        }
      } finally {
        if (active) timer = setTimeout(() => void load(), REFRESH_INTERVAL_MS);
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
