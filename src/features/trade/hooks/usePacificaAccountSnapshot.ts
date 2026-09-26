import { useCallback, useSyncExternalStore } from 'react';

import {
  readPacificaPortfolioSnapshot,
  subscribePacificaPortfolioSnapshot,
  type PacificaPortfolioStoreSnapshot,
} from '@/integrations/perps/pacifica/pacificaPortfolioStore';

const EMPTY: PacificaPortfolioStoreSnapshot = {
  data: null,
  status: 'loading',
  updatedAtMs: 0,
};

/**
 * The account's snapshot from the one shared portfolio store, for a surface that only reads it.
 *
 * The root lifecycle monitor owns polling and backfill; subscribing here starts no loop of its own, so a
 * screen can hold several readers of the account without adding a single request.
 */
export function usePacificaAccountSnapshot(
  apiOrigin: string,
  account: string | null,
): PacificaPortfolioStoreSnapshot {
  const subscribe = useCallback((listener: () => void) => (
    account === null || apiOrigin.length === 0
      ? () => undefined
      : subscribePacificaPortfolioSnapshot(apiOrigin, account, listener)
  ), [account, apiOrigin]);
  const read = useCallback(() => (
    account === null || apiOrigin.length === 0 ? EMPTY : readPacificaPortfolioSnapshot(apiOrigin, account)
  ), [account, apiOrigin]);
  return useSyncExternalStore(subscribe, read, read);
}
