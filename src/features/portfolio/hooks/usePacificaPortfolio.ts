import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchPacificaPortfolio,
  type PacificaPortfolioSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolio';

type PortfolioState = 'idle' | 'loading' | 'ready' | 'error';
const REFRESH_INTERVAL_MS = 5_000;

export function usePacificaPortfolio(apiOrigin: string, walletAddress: string | null) {
  const [snapshot, setSnapshot] = useState<PacificaPortfolioSnapshot | null>(null);
  const [status, setStatus] = useState<PortfolioState>('idle');
  const hasSnapshot = useRef(false);

  useEffect(() => {
    hasSnapshot.current = false;
    setSnapshot(null);
    setStatus(walletAddress === null ? 'idle' : 'loading');
  }, [walletAddress]);

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
        if (active && !controller.signal.aborted && !hasSnapshot.current) {
          if (__DEV__) console.error('[Perpal Pacifica portfolio failed]', { error: cause instanceof Error ? cause.message : typeof cause });
          setStatus('error');
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
  }, [apiOrigin, walletAddress]));

  return { snapshot, status };
}
