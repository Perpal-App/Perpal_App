import { useEffect, useState } from 'react';

import {
  fetchPacificaMarginSettings,
  type PacificaMarketSetting,
} from '@/integrations/perps/pacifica/pacificaOrderReconciliation';

type SharedRead = {
  readonly abort: AbortController;
  holders: number;
  readonly request: Promise<ReadonlyMap<string, PacificaMarketSetting>>;
};

/**
 * One read per account and set of positions, however many surfaces ask for it at the same moment.
 *
 * The portfolio values its positions in more than one place — the headline profit and loss, the balance's
 * trend and the cards — and each mounting together sent the same request once apiece. They now share the
 * one in flight, and it is cancelled only when the last of them lets go.
 */
const reads = new Map<string, SharedRead>();

function holdRead(account: string, apiOrigin: string, symbols: string) {
  const key = `${apiOrigin}|${account}|${symbols}`;
  let read = reads.get(key);
  if (read === undefined) {
    const abort = new AbortController();
    const request = fetchPacificaMarginSettings({ account, apiOrigin, signal: abort.signal });
    const created: SharedRead = { abort, holders: 0, request };
    reads.set(key, created);
    // Settled reads are not kept: the next set of positions, or the next visit, reads afresh.
    void request.finally(() => {
      if (reads.get(key) === created) reads.delete(key);
    }).catch(() => undefined);
    read = created;
  }
  const held = read;
  held.holders += 1;
  return {
    release: () => {
      held.holders -= 1;
      if (held.holders === 0 && reads.get(key) === held) {
        reads.delete(key);
        held.abort.abort();
      }
    },
    request: held.request,
  };
}

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
    const held = holdRead(account, apiOrigin, symbols);
    let current = true;
    void held.request
      .then((next) => {
        if (current) setSettings(next);
      })
      .catch(() => undefined);
    return () => {
      current = false;
      held.release();
    };
  }, [account, apiOrigin, symbols]);

  return settings;
}
