export type RootRouteMode = 'app' | 'auth' | 'onboarding';

type RootRouteModeInput = {
  hasSeenOnboardingIntro: boolean;
  isAuthenticated: boolean;
  isAwaitingEntry: boolean;
};

/** Keep exactly one root route group available for every resolved session. */
export function resolveRootRouteMode({
  hasSeenOnboardingIntro,
  isAuthenticated,
  isAwaitingEntry,
}: RootRouteModeInput): RootRouteMode {
  if (isAuthenticated && !isAwaitingEntry) return 'app';
  if (isAwaitingEntry || hasSeenOnboardingIntro) return 'auth';
  return 'onboarding';
}
