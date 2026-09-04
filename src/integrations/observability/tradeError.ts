import type { PerpsProviderId } from '@/config/appConfig';
import { recordClientTelemetry } from '@/integrations/observability/clientTelemetry';

export function logTradeError(
  provider: PerpsProviderId,
  phase: 'preparation' | 'submission',
  cause: unknown,
): void {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause
    ? String(cause.code)
    : 'unknown';
  const message = cause instanceof Error ? cause.message : 'Unknown trade failure.';

  console.error('[Perpal trade]', JSON.stringify({
    provider,
    phase,
    errorName: cause instanceof Error ? cause.name : typeof cause,
    errorCode: code,
    errorMessage: message
      .replace(/https?:\/\/\S+/giu, '[url]')
      .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/gu, '[address]'),
  }));
  recordClientTelemetry({
    durationMs: 0,
    errorCode: code,
    operation: `trade.${provider}.${phase}`,
    outcome: 'error',
  });
}
