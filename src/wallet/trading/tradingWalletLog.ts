export function logTradingWalletError(
  phase: 'activate' | 'restore',
  cause: unknown,
): void {
  if (__DEV__) {
    console.error('[Perpal private trading wallet failed]', {
      phase,
      errorName: cause instanceof Error ? cause.name : typeof cause,
    });
  }
}
