export type TradeTimingContext = {
  readonly action: 'open' | 'reduce' | 'close';
  readonly intentStartedAtMs: number;
  readonly provider: 'flash';
};

export function logTradeTiming(
  context: TradeTimingContext,
  phase: 'intent_to_submission' | 'submission_to_acknowledgement',
  startedAtMs: number,
  outcome: 'ok' | 'error' | 'unknown',
): void {
  console.info('[Perpal trade timing]', JSON.stringify({
    action: context.action,
    durationMs: Math.max(0, Math.round(performance.now() - startedAtMs)),
    outcome,
    phase,
    provider: context.provider,
  }));
}
