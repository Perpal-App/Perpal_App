import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

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

/**
 * Reads the Pacifica history maintained by `PacificaAccountLifecycleMonitor`.
 *
 * This hook used to be a second automatic owner of the same three endpoints. The root monitor fetched
 * account activity every five seconds while this hook independently fetched on focus, so opening or
 * returning from the public-wallet signing prompt produced a `latest` and a `backfill` pass over the
 * same history. The coordinator usually served one from cache, but both passes still parsed, merged,
 * published, logged and could abort each other's visible lifecycle during focus changes.
 *
 * The root monitor is mounted above navigation and already owns foreground catch-up, polling, backoff,
 * checkpointing and publication. A screen should subscribe to that result, not recreate its lifecycle.
 * The only write path kept here is an explicit Retry press: it performs one forced network refresh and
 * publishes through the same store. That preserves the control's meaning without restoring a second
 * automatic poller.
 */
export function usePacificaActivity(apiOrigin: string, account: string) {
  const request = useRef<AbortController | null>(null);
  const subscribe = useCallback(
    (listener: () => void) => subscribePacificaActivitySnapshot(apiOrigin, account, listener),
    [account, apiOrigin],
  );
  const read = useCallback(
    () => readPacificaActivitySnapshot(apiOrigin, account),
    [account, apiOrigin],
  );
  const state = useSyncExternalStore(subscribe, read, read);

  useEffect(() => () => request.current?.abort(), [account, apiOrigin]);

  const refresh = useCallback(() => {
    if (account.length === 0 || apiOrigin.length === 0) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = readPacificaActivitySnapshot(apiOrigin, account);

    void fetchPacificaActivity(
      apiOrigin,
      account,
      controller.signal,
      current.data === null || current.data.incomplete ? 'backfill' : 'latest',
      'network',
    ).then((activity) => {
      if (controller.signal.aborted || request.current !== controller) return;
      publishPacificaActivitySnapshot({ account, activity, apiOrigin });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted || request.current !== controller) return;
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
    }).finally(() => {
      if (request.current === controller) request.current = null;
    });
  }, [account, apiOrigin]);

  return { refresh, state };
}
