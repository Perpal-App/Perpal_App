import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import {
  fetchPythMarketHistory,
  type MarketCandle,
  type MarketTimeframe,
} from '@/integrations/perps/markets/pythHistory';

export type MarketHistoryStatus = 'loading' | 'ready' | 'stale' | 'error';

const REFRESH_INTERVAL_MS = 30_000;

export function usePythMarketHistory(
  origin: string,
  ticker: string,
  timeframe: MarketTimeframe,
) {
  const [candles, setCandles] = useState<readonly MarketCandle[]>([]);
  const [status, setStatus] = useState<MarketHistoryStatus>('loading');
  const [updatedAtMs, setUpdatedAtMs] = useState<number | null>(null);
  const hasData = useRef(false);

  useFocusEffect(
    useCallback(() => {
      hasData.current = false;
      setCandles([]);
      setStatus('loading');
      setUpdatedAtMs(null);

      let active = true;
      let controller: AbortController | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const load = async () => {
        controller?.abort();
        controller = new AbortController();

        try {
          const next = await fetchPythMarketHistory(
            origin,
            ticker,
            timeframe,
            controller.signal,
          );
          if (!active) return;

          hasData.current = next.length > 0;
          setCandles(next);
          setUpdatedAtMs(Date.now());
          setStatus(next.length > 0 ? 'ready' : 'error');
        } catch {
          if (active && !controller.signal.aborted) {
            setStatus(hasData.current ? 'stale' : 'error');
          }
        } finally {
          if (active) {
            timer = setTimeout(() => void load(), REFRESH_INTERVAL_MS);
          }
        }
      };

      if (origin.length > 0 && ticker.length > 0) {
        void load();
      } else {
        setStatus('error');
      }

      return () => {
        active = false;
        controller?.abort();
        if (timer !== undefined) clearTimeout(timer);
      };
    }, [origin, ticker, timeframe]),
  );

  return { candles, status, updatedAtMs };
}
