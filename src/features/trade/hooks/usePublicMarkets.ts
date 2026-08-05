import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import {
  fetchPublicMarketPrices,
  type PublicMarketPrice,
} from '@/integrations/perps/markets/publicMarketData';

type MarketLoadState = 'loading' | 'ready' | 'error';

export function usePublicMarkets(url: string) {
  const [prices, setPrices] = useState<readonly PublicMarketPrice[]>([]);
  const [status, setStatus] = useState<MarketLoadState>('loading');
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    if (prices.length === 0) {
      setStatus('loading');
    }

    try {
      const nextPrices = await fetchPublicMarketPrices(url, controller.signal);

      if (!controller.signal.aborted) {
        setPrices(nextPrices);
        setStatus('ready');
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (__DEV__) {
          console.error('[Perpal public market data failed]', {
            errorName: cause instanceof Error ? cause.name : typeof cause,
          });
        }
        setStatus('error');
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
      }
    }
  }, [prices.length, url]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const interval = setInterval(() => void refresh(), 15_000);

      return () => {
        clearInterval(interval);
        requestRef.current?.abort();
      };
    }, [refresh]),
  );

  return { prices, refresh, status };
}
