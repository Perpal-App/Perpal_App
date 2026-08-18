import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import type { MarketHistoryStatus } from '@/features/trade/hooks/usePacificaMarketHistory';
import type {
  MarketCandle,
  MarketTimeframe,
} from '@/integrations/perps/pacifica/pacificaHistory';
import { fetchPacificaMarketHistory } from '@/integrations/perps/pacifica/pacificaHistory';
import { fetchVelocityMarketHistory } from '@/integrations/perps/velocity/velocityHistory';

const REFRESH_INTERVAL_MS = 30_000;

export function useVelocityMarketHistory(
  url: string,
  pacificaApiOrigin: string,
  symbol: string,
  timeframe: MarketTimeframe,
  enabled: boolean,
) {
  const [candles, setCandles] = useState<readonly MarketCandle[]>([]);
  const [status, setStatus] = useState<MarketHistoryStatus>('loading');
  const [source, setSource] = useState<'pyth' | 'pacifica'>('pyth');
  const hasData = useRef(false);

  useFocusEffect(useCallback(() => {
    hasData.current = false;
    setCandles([]);
    setStatus('loading');
    if (!enabled || url.length === 0 || symbol.length === 0) return undefined;
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        let next: readonly MarketCandle[];
        let nextSource: 'pyth' | 'pacifica' = 'pyth';
        try {
          next = await fetchVelocityMarketHistory(url, symbol, timeframe, controller.signal);
        } catch {
          if (controller.signal.aborted) return;
          next = await fetchPacificaMarketHistory(
            pacificaApiOrigin,
            symbol,
            timeframe,
            controller.signal,
          );
          nextSource = 'pacifica';
        }
        if (!active) return;
        hasData.current = next.length > 0;
        setCandles(next);
        setSource(nextSource);
        setStatus(next.length > 0 ? 'ready' : 'error');
      } catch {
        if (active && !controller.signal.aborted) setStatus(hasData.current ? 'stale' : 'error');
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
  }, [enabled, pacificaApiOrigin, symbol, timeframe, url]));

  return { candles, source, status };
}
