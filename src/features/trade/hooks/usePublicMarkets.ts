import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import {
  fetchPublicMarketPrices,
  streamPublicMarketPrices,
  type PublicMarketPrice,
} from '@/integrations/perps/markets/publicMarketData';

type MarketLoadState = 'loading' | 'ready' | 'error';
export type MarketStreamState = 'connecting' | 'live' | 'reconnecting';

export function usePublicMarkets(
  snapshotUrl: string,
  streamUrl: string,
  enabled = true,
) {
  const [prices, setPrices] = useState<readonly PublicMarketPrice[]>([]);
  const [status, setStatus] = useState<MarketLoadState>('loading');
  const [streamState, setStreamState] =
    useState<MarketStreamState>('connecting');
  const snapshotRef = useRef<AbortController | null>(null);
  const newestPublishTimeRef = useRef(0);
  const hasPricesRef = useRef(false);

  const applyPrices = useCallback((nextPrices: readonly PublicMarketPrice[]) => {
    const newest = Math.max(...nextPrices.map((price) => price.publishedAtMs));

    if (newest < newestPublishTimeRef.current) {
      return;
    }

    newestPublishTimeRef.current = newest;
    hasPricesRef.current = true;
    setPrices(nextPrices);
    setStatus('ready');
  }, []);

  const refresh = useCallback(async () => {
    snapshotRef.current?.abort();
    const controller = new AbortController();
    snapshotRef.current = controller;

    if (!hasPricesRef.current) {
      setStatus('loading');
    }

    try {
      applyPrices(await fetchPublicMarketPrices(snapshotUrl, controller.signal));
    } catch (cause) {
      if (!controller.signal.aborted) {
        logMarketError('snapshot', cause);

        if (!hasPricesRef.current) {
          setStatus('error');
        }
      }
    } finally {
      if (snapshotRef.current === controller) {
        snapshotRef.current = null;
      }
    }
  }, [applyPrices, snapshotUrl]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) {
        return undefined;
      }

      const controller = new AbortController();
      let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
      let attempt = 0;

      const connect = async (): Promise<void> => {
        setStreamState(attempt === 0 ? 'connecting' : 'reconnecting');

        try {
          await streamPublicMarketPrices(
            streamUrl,
            controller.signal,
            (nextPrices) => {
              attempt = 0;
              applyPrices(nextPrices);
              setStreamState('live');
            },
          );
        } catch (cause) {
          if (controller.signal.aborted) {
            return;
          }

          logMarketError('stream', cause);
          setStreamState('reconnecting');

          if (!hasPricesRef.current) {
            setStatus('error');
          }

          reconnectTimer = setTimeout(
            () => void connect(),
            reconnectDelay(attempt++),
          );
        }
      };

      void refresh();
      void connect();

      return () => {
        controller.abort();
        snapshotRef.current?.abort();

        if (reconnectTimer !== undefined) {
          clearTimeout(reconnectTimer);
        }
      };
    }, [applyPrices, enabled, refresh, streamUrl]),
  );

  return { prices, refresh, status, streamState };
}

function reconnectDelay(attempt: number): number {
  const backoff = Math.min(1_000 * 2 ** Math.min(attempt, 4), 15_000);
  return backoff + Math.floor(Math.random() * 500);
}

function logMarketError(boundary: 'snapshot' | 'stream', cause: unknown): void {
  if (__DEV__) {
    console.error('[Perpal public market data failed]', {
      boundary,
      errorName: cause instanceof Error ? cause.name : typeof cause,
    });
  }
}
