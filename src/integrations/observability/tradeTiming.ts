import { recordClientTelemetry } from '@/integrations/observability/clientTelemetry';

export type TradeTimingContext = {
  readonly action: 'open' | 'reduce' | 'close';
  readonly intentStartedAtMs: number;
  readonly provider: 'pacifica';
  readonly traceId?: string;
};

export function logTradeTiming(
  context: TradeTimingContext,
  phase: 'intent_to_submission' | 'submission_to_acknowledgement',
  startedAtMs: number,
  outcome: 'ok' | 'error' | 'unknown',
): void {
  const durationMs = Math.max(0, Math.round(performance.now() - startedAtMs));
  console.info('[Perpal trade timing]', JSON.stringify({
    action: context.action,
    durationMs,
    outcome,
    phase,
    provider: context.provider,
  }));
  recordClientTelemetry({
    durationMs,
    operation: `trade.${context.provider}.${context.action}.${phase}`,
    outcome: outcome === 'ok' ? 'ok' : outcome,
    ...(context.traceId === undefined ? {} : { traceId: context.traceId }),
  });
}
