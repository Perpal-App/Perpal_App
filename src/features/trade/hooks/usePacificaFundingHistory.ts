import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import {
  fetchPacificaFundingHistory,
  type PacificaFundingPoint,
} from '@/integrations/perps/pacifica/pacificaPublicMarket';

export type PacificaFundingHistoryState = {
  readonly points: readonly PacificaFundingPoint[];
  readonly status: 'loading' | 'ready' | 'error';
};

export function usePacificaFundingHistory(
  apiOrigin: string,
  symbol: string,
  limit: number,
): PacificaFundingHistoryState {
  const [state, setState] = useState<PacificaFundingHistoryState>({
    points: [],
    status: 'loading',
  });

  useFocusEffect(
    useCallback(() => {
      if (apiOrigin.length === 0 || symbol.length === 0) {
        setState({ points: [], status: 'error' });
        return undefined;
      }
      const controller = new AbortController();
      setState({ points: [], status: 'loading' });
      void fetchPacificaFundingHistory(apiOrigin, symbol, limit, controller.signal)
        .then((points) => {
          if (!controller.signal.aborted) setState({ points, status: 'ready' });
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setState({ points: [], status: 'error' });
          if (__DEV__) console.error('[Perpal Pacifica funding history failed]', {
            error: cause instanceof Error ? `${cause.name}:${cause.message}` : typeof cause,
            symbol,
          });
        });
      return () => controller.abort();
    }, [apiOrigin, limit, symbol]),
  );

  return state;
}
