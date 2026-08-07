import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { readAppConfig } from '@/config/appConfig';
import { resumeFlashSettlements } from '@/integrations/perps/flash/flashSettlement';
import { readPendingFlashSettlements } from '@/integrations/perps/flash/flashSettlementStorage';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

export function ProviderSettlementProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const session = useTradingSession();
  const runningRef = useRef(false);

  const resume = useCallback(async () => {
    const config = readAppConfig();
    if (
      runningRef.current ||
      !config.ok ||
      session.status !== 'ready' ||
      session.address === null ||
      session.signer === null
    ) {
      return;
    }

    runningRef.current = true;
    try {
      const flashPending = await readPendingFlashSettlements(session.address);
      if (flashPending.length === 0) return;
      console.info('[Perpal recovery]', JSON.stringify({
        event: 'auto_resume',
        flashPending: flashPending.length,
        operation: 'provider_settlement',
      }));
      if (session.flashFeeSigner !== null) {
        await resumeFlashSettlements({
          erRpcUrl: config.value.perps.flashErRpc,
          feeSigner: session.flashFeeSigner,
          owner: session.address,
          programId: config.value.perps.flashProgramId,
          rpcUrl: config.value.api.rpcUrl,
          signer: session.signer,
        });
      }
      const flashRemaining = await readPendingFlashSettlements(session.address);
      console.info('[Perpal recovery]', JSON.stringify({
        event: 'resume_complete',
        flashPending: flashRemaining.length,
        operation: 'provider_settlement',
      }));
    } catch (cause) {
      if (__DEV__) {
        console.error('[Perpal provider settlement recovery failed]', {
          errorName: cause instanceof Error ? cause.name : typeof cause,
        });
      }
    } finally {
      runningRef.current = false;
    }
  }, [session.address, session.flashFeeSigner, session.signer, session.status]);

  useEffect(() => {
    void resume();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void resume();
    });
    return () => subscription.remove();
  }, [resume]);

  return children;
}
