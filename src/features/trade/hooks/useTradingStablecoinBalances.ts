import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { readTokenBalance } from '@/integrations/solana/stablecoinSwap';

export type TradingStablecoinBalances = {
  readonly usdcBaseUnits: bigint;
};

type BalanceStatus = 'idle' | 'loading' | 'ready' | 'error';
const REFRESH_INTERVAL_MS = 5_000;

/**
 * The last balance read, so a remount does not start from nothing.
 *
 * The order ticket lives in a sheet that unmounts on close, so every open used to restart this hook at
 * `null` and wait on a round trip before it could tell whether the wallet had anything in it. That wait
 * is what made the ticket render its input controls and then replace them with "Insufficient funds" a
 * moment later.
 *
 * One entry, not a map, and it carries its owner: a cache keyed by identity cannot be read for the
 * wrong one, and replacing it on a different owner bounds it by construction. In memory only — a
 * balance is not something to persist.
 */
let cached: { readonly owner: string; readonly value: TradingStablecoinBalances } | null = null;

function readCache(owner: string | null): TradingStablecoinBalances | null {
  return owner !== null && cached?.owner === owner ? cached.value : null;
}

export function useTradingStablecoinBalances(input: {
  readonly owner: string | null;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner | null;
  readonly usdcMint: string;
}) {
  // Seeded on the first render rather than in an effect, which is the whole point: the value is there
  // before anything paints, so a caller reading it never sees a frame that says "unknown".
  const [balances, setBalances] = useState<TradingStablecoinBalances | null>(
    () => readCache(input.owner),
  );
  const [status, setStatus] = useState<BalanceStatus>(
    () => (readCache(input.owner) === null ? 'idle' : 'ready'),
  );
  const hasBalances = useRef(readCache(input.owner) !== null);

  useEffect(() => {
    const seed = readCache(input.owner);
    hasBalances.current = seed !== null;
    setBalances(seed);
    setStatus(input.owner === null || input.signer === null
      ? 'idle'
      : seed === null ? 'loading' : 'ready');
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
        const value = { usdcBaseUnits };
        cached = { owner, value };
        if (active) {
          hasBalances.current = true;
          setBalances(value);
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
