import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  fetchFearGreedIndex,
  type FearGreedIndex,
} from '@/integrations/market-data/fearGreed';

const REFRESH_INTERVAL_MS = 60 * 1_000;

export type FearGreedState = {
  readonly data: FearGreedIndex | null;
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
};

export function useFearGreed(url: string): FearGreedState {
  const [state, setState] = useState<FearGreedState>({ data: null, status: 'idle' });

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
        const data = await fetchFearGreedIndex(url, controller.signal);
        if (active) setState({ data, status: 'ready' });
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        if (__DEV__) {
          console.error('[Perpal Fear and Greed failed]', {
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
