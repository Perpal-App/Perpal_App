import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchFlashPortfolio,
  type FlashPortfolioSnapshot,
} from '@/integrations/perps/flash/flashPortfolio';

type PortfolioState = 'idle' | 'loading' | 'ready' | 'error';
const REFRESH_INTERVAL_MS = 5_000;

export function useFlashPortfolio(
  erRpcUrl: string,
  programId: string,
  walletAddress: string | null,
) {
  const [snapshot, setSnapshot] = useState<FlashPortfolioSnapshot | null>(null);
  const [status, setStatus] = useState<PortfolioState>('idle');
  const hasSnapshotRef = useRef(false);
  const lastLoggedErrorRef = useRef<string | null>(null);

  useEffect(() => {
    hasSnapshotRef.current = false;
    lastLoggedErrorRef.current = null;
    setSnapshot(null);
    setStatus(walletAddress === null ? 'idle' : 'loading');
  }, [walletAddress]);

  useFocusEffect(
    useCallback(() => {
      if (
        walletAddress === null ||
        erRpcUrl.length === 0 ||
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
          const next = await fetchFlashPortfolio(
            erRpcUrl,
            programId,
            walletAddress,
            controller.signal,
          );

          if (active) {
            hasSnapshotRef.current = true;
            lastLoggedErrorRef.current = null;
            setSnapshot(next);
            setStatus('ready');
          }
        } catch (cause) {
          if (active && !controller.signal.aborted) {
            const diagnostic = cause instanceof Error
              ? `${cause.name}:${cause.message}`
              : typeof cause;

            if (lastLoggedErrorRef.current !== diagnostic) {
              lastLoggedErrorRef.current = diagnostic;
              logPortfolioError(cause);
            }

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
    }, [erRpcUrl, programId, walletAddress]),
  );

  return { snapshot, status };
}

function logPortfolioError(cause: unknown): void {
  if (__DEV__) {
    console.error('[Perpal Flash ER portfolio failed]', {
      errorName: cause instanceof Error ? cause.name : typeof cause,
      errorMessage:
        cause instanceof Error ? cause.message : 'Unknown Flash portfolio failure.',
    });
  }
}
