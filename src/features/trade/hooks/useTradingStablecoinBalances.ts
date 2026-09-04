import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { readTokenBalance } from '@/integrations/solana/stablecoinSwap';

export type TradingStablecoinBalances = {
  readonly usdcBaseUnits: bigint;
};

type BalanceStatus = 'idle' | 'loading' | 'ready' | 'error';
const REFRESH_INTERVAL_MS = 5_000;

export function useTradingStablecoinBalances(input: {
  readonly owner: string | null;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner | null;
  readonly usdcMint: string;
}) {
  const [balances, setBalances] = useState<TradingStablecoinBalances | null>(null);
  const [status, setStatus] = useState<BalanceStatus>('idle');
  const hasBalances = useRef(false);

  useEffect(() => {
    hasBalances.current = false;
    setBalances(null);
    setStatus(input.owner === null || input.signer === null ? 'idle' : 'loading');
  }, [input.owner, input.signer]);

  useFocusEffect(useCallback(() => {
    const owner = input.owner;
    const signer = input.signer;
    if (owner === null || signer === null) return undefined;
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      if (!hasBalances.current) setStatus('loading');
      try {
        const usdcBaseUnits = await readTokenBalance({
          mint: input.usdcMint,
          owner,
          rpcUrl: input.rpcUrl,
          signal: controller.signal,
          signer,
        });
        if (active) {
          hasBalances.current = true;
          setBalances({ usdcBaseUnits });
          setStatus('ready');
        }
      } catch (cause) {
        if (active && !controller.signal.aborted && !hasBalances.current) {
          setStatus('error');
          if (__DEV__) {
            console.warn('[Perpal trading balance failed]', {
              errorName: cause instanceof Error ? cause.name : typeof cause,
            });
          }
        }
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
  }, [input.owner, input.rpcUrl, input.signer, input.usdcMint]));

  return { balances, status };
}
