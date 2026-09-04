import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';

import { fetchPacificaActivity } from '@/integrations/perps/pacifica/pacificaActivity';
import {
  isPacificaRateLimited,
  PacificaApiError,
} from '@/integrations/perps/pacifica/pacificaApi';
import {
  markPacificaActivityUnavailable,
  publishPacificaActivitySnapshot,
  readPacificaActivitySnapshot,
  subscribePacificaActivitySnapshot,
} from '@/integrations/perps/pacifica/pacificaActivityStore';

const FOCUS_REFRESH_AFTER_MS = 60_000;

export function usePacificaActivity(apiOrigin: string, account: string) {
  const [refreshKey, setRefreshKey] = useState(0);
  const forceNetwork = useRef(false);
  const subscribe = useCallback(
    (listener: () => void) => subscribePacificaActivitySnapshot(apiOrigin, account, listener),
    [account, apiOrigin],
  );
  const read = useCallback(
    () => readPacificaActivitySnapshot(apiOrigin, account),
    [account, apiOrigin],
  );
  const state = useSyncExternalStore(subscribe, read, read);

  const refresh = useCallback(() => {
    forceNetwork.current = true;
    setRefreshKey((value) => value + 1);
  }, []);

  useFocusEffect(useCallback(() => {
    if (account.length === 0 || apiOrigin.length === 0) return undefined;
    const current = readPacificaActivitySnapshot(apiOrigin, account);
    const forced = forceNetwork.current;
    forceNetwork.current = false;
    if (
      !forced
      && current.data !== null
      && Date.now() - current.updatedAtMs < FOCUS_REFRESH_AFTER_MS
    ) return undefined;

    const controller = new AbortController();
    void fetchPacificaActivity(
      apiOrigin,
      account,
      controller.signal,
      current.data === null || current.data.incomplete ? 'backfill' : 'latest',
      forced ? 'network' : 'cached',
    ).then((activity) => {
      if (controller.signal.aborted) return;
      publishPacificaActivitySnapshot({ account, activity, apiOrigin });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      markPacificaActivityUnavailable({
        account,
        apiOrigin,
        rateLimited: isPacificaRateLimited(cause),
      });
      if (__DEV__ && !isPacificaRateLimited(cause)) {
        console.warn(
          '[Perpal activity refresh failed]',
          cause instanceof PacificaApiError
            ? {
                errorCode: cause.code,
                errorName: cause.name,
                requestPath: cause.requestPath,
                status: cause.status,
              }
            : { errorName: cause instanceof Error ? cause.name : typeof cause },
        );
      }
    });

    return () => controller.abort();
  }, [account, apiOrigin, refreshKey]));

  return { refresh, state };
}
