import { useEffect, useState } from 'react';

import {
  fetchPacificaMarginSettings,
  type PacificaMarketSetting,
} from '@/integrations/perps/pacifica/pacificaOrderReconciliation';

/**
 * The account's margin setting for each market, which is where a position's leverage lives: the venue
 * pins a market's leverage while there is exposure on it, so the setting is the position's.
 *
 * Read once for the set of positions on screen, and again whenever that set changes — a position opened or
 * closed — which is keyed by `symbols`. `null` until the first read lands, and kept at the last good read if
 * a later one fails, so a card shows its capital as unavailable rather than as a guess.
 */
export function useMarginSettings(input: {
  readonly account: string | null;
  readonly apiOrigin: string;
  /** The positions' symbols, joined: a change in the set is what warrants a new read. */
  readonly symbols: string;
}): ReadonlyMap<string, PacificaMarketSetting> | null {
  const { account, apiOrigin, symbols } = input;
  const [settings, setSettings] = useState<ReadonlyMap<string, PacificaMarketSetting> | null>(null);

  useEffect(() => {
    if (account === null || apiOrigin.length === 0 || symbols.length === 0) return undefined;
    const abort = new AbortController();
    void fetchPacificaMarginSettings({ account, apiOrigin, signal: abort.signal })
      .then((next) => {
        if (!abort.signal.aborted) setSettings(next);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [account, apiOrigin, symbols]);

  return settings;
}
