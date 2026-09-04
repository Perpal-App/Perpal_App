import { useEffect } from 'react';
import { AppState } from 'react-native';

import {
  flushClientTelemetry,
  setClientTelemetrySigner,
} from '@/integrations/observability/clientTelemetry';
import { useTradingSession } from '@/wallet/trading/TradingSessionProvider';

/** Connects redacted telemetry to T's request signer without persisting signing capability. */
export function ClientTelemetryBridge() {
  const session = useTradingSession();

  useEffect(() => {
    setClientTelemetrySigner(session.status === 'ready' ? session.signer : null);
    return () => setClientTelemetrySigner(null);
  }, [session.signer, session.status]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flushClientTelemetry();
    });
    return () => subscription.remove();
  }, []);

  return null;
}
