import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchVelocityPortfolio,
  type VelocityPortfolioSnapshot,
} from '@/integrations/perps/velocity/velocityPortfolio';
import type { MainnetMarket } from '@/integrations/perps/markets/mainnetCatalog';
import type { PublicMarketPrice } from '@/integrations/perps/markets/publicMarketData';

type PortfolioState = 'idle' | 'loading' | 'ready' | 'error';
const REFRESH_INTERVAL_MS = 5_000;

export function useVelocityPortfolio(
  rpcUrl: string,
  programId: string,
  walletAddress: string | null,
  markets: readonly MainnetMarket[],
  prices: readonly PublicMarketPrice[],
) {
  const [snapshot, setSnapshot] = useState<VelocityPortfolioSnapshot | null>(null);
  const [status, setStatus] = useState<PortfolioState>('idle');
  const marketsRef = useRef(markets);
  const pricesRef = useRef(prices);
  const hasSnapshotRef = useRef(false);

  useEffect(() => {
    marketsRef.current = markets;
    pricesRef.current = prices;
  }, [markets, prices]);

  useEffect(() => {
    hasSnapshotRef.current = false;
    setSnapshot(null);
    setStatus(walletAddress === null ? 'idle' : 'loading');
  }, [walletAddress]);

  useFocusEffect(
    useCallback(() => {
      if (
        walletAddress === null ||
        rpcUrl.length === 0 ||
        programId.length === 0
      ) {
        hasSnapshotRef.current = false;
        setSnapshot(null);
        setStatus('idle');
        return undefined;
      }

      let active = true;
      let controller: AbortController | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const load = async (): Promise<void> => {
        controller?.abort();
        controller = new AbortController();

        if (!hasSnapshotRef.current) {
          setStatus('loading');
        }

        try {
          const next = await fetchVelocityPortfolio(
            rpcUrl,
            programId,
            walletAddress,
            marketsRef.current,
            pricesRef.current,
            controller.signal,
          );

          if (active) {
            hasSnapshotRef.current = true;
            setSnapshot(next);
            setStatus('ready');
          }
        } catch (cause) {
          if (active && !controller.signal.aborted) {
            logPortfolioError(cause);

            if (!hasSnapshotRef.current) {
              setStatus('error');
            }
          }
        } finally {
          if (active) {
            timer = setTimeout(() => void load(), REFRESH_INTERVAL_MS);
          }
        }
      };

      void load();

      return () => {
        active = false;
        controller?.abort();

        if (timer !== undefined) {
          clearTimeout(timer);
        }
      };
    }, [programId, rpcUrl, walletAddress]),
  );

  return { snapshot, status };
}

function logPortfolioError(cause: unknown): void {
  if (__DEV__) {
    console.error('[Perpal Velocity portfolio failed]', {
      errorName: cause instanceof Error ? cause.name : typeof cause,
    });
  }
}
