import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import {
  fetchPacificaMarketHistory,
  type MarketCandle,
  type MarketTimeframe,
} from '@/integrations/perps/pacifica/pacificaHistory';

export type MarketHistoryStatus = 'loading' | 'ready' | 'stale' | 'error';
const REFRESH_INTERVAL_MS = 30_000;

export function usePacificaMarketHistory(
  apiOrigin: string,
  symbol: string,
  timeframe: MarketTimeframe,
  enabled = true,
) {
  const [candles, setCandles] = useState<readonly MarketCandle[]>([]);
  const [status, setStatus] = useState<MarketHistoryStatus>('loading');
  const hasData = useRef(false);

  useFocusEffect(useCallback(() => {
    if (!enabled) return undefined;
    hasData.current = false;
    setCandles([]);
    setStatus('loading');
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await fetchPacificaMarketHistory(apiOrigin, symbol, timeframe, controller.signal);
        if (!active) return;
        hasData.current = next.length > 0;
        setCandles(next);
        setStatus(next.length > 0 ? 'ready' : 'error');
      } catch {
        if (active && !controller.signal.aborted) setStatus(hasData.current ? 'stale' : 'error');
      } finally {
        if (active) timer = setTimeout(() => void load(), REFRESH_INTERVAL_MS);
      }
    };
    if (apiOrigin.length > 0 && symbol.length > 0) void load();
    else setStatus('error');
    return () => {
      active = false;
      controller?.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [apiOrigin, enabled, symbol, timeframe]));

  return { candles, status };
}
