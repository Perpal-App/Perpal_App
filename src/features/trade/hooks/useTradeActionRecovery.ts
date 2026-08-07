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
      setPending(status === 'pending');
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

  return { error, pending, reconcile, setPending };
}
