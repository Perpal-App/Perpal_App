import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { readAppConfig } from '@/config/appConfig';
import { resumeFlashSettlements } from '@/integrations/perps/flash/flashSettlement';
import { readPendingFlashSettlements } from '@/integrations/perps/flash/flashSettlementStorage';
import { resumeVelocitySettlements } from '@/integrations/perps/velocity/velocitySettlement';
import { readPendingVelocitySettlements } from '@/integrations/perps/velocity/velocitySettlementStorage';
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
      const [velocityPending, flashPending] = await Promise.all([
        readPendingVelocitySettlements(session.address),
        readPendingFlashSettlements(session.address),
      ]);
      if (velocityPending.length + flashPending.length === 0) return;
      console.info('[Perpal recovery]', JSON.stringify({
        event: 'auto_resume',
        flashPending: flashPending.length,
        operation: 'provider_settlement',
        velocityPending: velocityPending.length,
      }));
      await Promise.all([
        ...(velocityPending.length === 0 ? [] : [resumeVelocitySettlements({
          owner: session.address,
          marketDataUrl: config.value.api.marketDataUrl,
          programId: config.value.perps.velocityProgramId,
          rpcUrl: config.value.api.rpcUrl,
          signer: session.signer,
        })]),
        ...(session.flashFeeSigner === null || flashPending.length === 0
          ? []
          : [resumeFlashSettlements({
          erRpcUrl: config.value.perps.flashErRpc,
          feeSigner: session.flashFeeSigner,
          owner: session.address,
          programId: config.value.perps.flashProgramId,
          rpcUrl: config.value.api.rpcUrl,
          signer: session.signer,
        })]),
      ]);
      const [velocityRemaining, flashRemaining] = await Promise.all([
        readPendingVelocitySettlements(session.address),
        readPendingFlashSettlements(session.address),
      ]);
      console.info('[Perpal recovery]', JSON.stringify({
        event: 'resume_complete',
        flashPending: flashRemaining.length,
        operation: 'provider_settlement',
        velocityPending: velocityRemaining.length,
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
