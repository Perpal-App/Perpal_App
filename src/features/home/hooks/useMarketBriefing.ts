import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  fetchMarketBriefing,
  type MarketBriefing,
} from '@/integrations/market-data/marketBriefing';

const REFRESH_INTERVAL_MS = 5 * 60 * 1_000;

export type MarketBriefingState = {
  readonly data: MarketBriefing | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
};

export function useMarketBriefing(url: string): MarketBriefingState {
  const [state, setState] = useState<MarketBriefingState>({
    data: null,
    status: 'idle',
  });

  useFocusEffect(useCallback(() => {
    if (url.length === 0) return undefined;
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    setState((current) => ({
      data: current.data,
      status: current.data === null ? 'loading' : 'ready',
    }));

    const refresh = async () => {
      controller = new AbortController();
      try {
        const data = await fetchMarketBriefing(url, controller.signal);
        if (active) setState({ data, status: 'ready' });
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        if (__DEV__) {
          console.error('[Perpal market briefing failed]', {
            error: cause instanceof Error ? cause.message : typeof cause,
          });
        }
        setState((current) => ({ data: current.data, status: 'error' }));
      } finally {
        if (active) timer = setTimeout(() => void refresh(), REFRESH_INTERVAL_MS);
      }
    };

    void refresh();
    return () => {
      active = false;
      controller?.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [url]));

  return state;
}
