import { resolveRootRouteMode } from '@/navigation/rootRouteMode';

describe('resolveRootRouteMode', () => {
  it('never exposes onboarding again after the introduction is completed', () => {
    expect(
      resolveRootRouteMode({
        hasSeenOnboardingIntro: false,
        isAuthenticated: false,
        isAwaitingEntry: false,
      }),
    ).toBe('onboarding');

    expect(
      resolveRootRouteMode({
        hasSeenOnboardingIntro: true,
        isAuthenticated: false,
        isAwaitingEntry: false,
      }),
    ).toBe('auth');

    expect(
      resolveRootRouteMode({
        hasSeenOnboardingIntro: true,
        isAuthenticated: true,
        isAwaitingEntry: true,
      }),
    ).toBe('auth');

    expect(
      resolveRootRouteMode({
        hasSeenOnboardingIntro: true,
        isAuthenticated: true,
        isAwaitingEntry: false,
      }),
    ).toBe('app');
  });
});
