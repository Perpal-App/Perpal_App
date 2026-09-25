import { useCallback, useEffect, useState } from 'react';

import type { PerpsProviderId } from '@/config/appConfig';
import type { GatewayRequestSigner } from '@/integrations/api/gatewayClient';
import { reconcilePendingTradeAction } from '@/integrations/perps/tradeActionRecovery';

export function useTradeActionRecovery(input: {
  readonly owner: string | null;
  readonly provider: PerpsProviderId;
  readonly rpcUrl: string;
  readonly signer: GatewayRequestSigner | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reconcile = useCallback(async (signal?: AbortSignal) => {
    if (input.owner === null || input.signer === null) return 'none' as const;
    setError(null);
    try {
      const status = await reconcilePendingTradeAction({
        owner: input.owner,
        provider: input.provider,
        rpcUrl: input.rpcUrl,
        signer: input.signer,
        ...(signal === undefined ? {} : { signal }),
      });
      setPending(status === 'pending' || status === 'indexing');
      return status;
    } catch (cause) {
      if (!signal?.aborted) {
        setPending(false);
        setError(cause instanceof Error
          ? cause.message
          : 'Trade preparation recovery failed.');
      }
      throw cause;
    }
  }, [input.owner, input.provider, input.rpcUrl, input.signer]);

  useEffect(() => {
    const controller = new AbortController();
    void reconcile(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [reconcile]);

  // Pending includes Pacifica's backend-indexing phase. Keep the local flag synchronized with the
  // durable record so a root settlement that clears it removes the ticket's non-actionable funding
  // state without requiring the user to close or press Refresh.
  useEffect(() => {
    if (!pending) return undefined;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      await reconcile(controller.signal).catch(() => undefined);
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3_000);
    };
    timer = setTimeout(() => void poll(), 3_000);
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pending, reconcile]);

  return { error, pending, reconcile, setPending };
}
