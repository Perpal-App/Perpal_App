import { createMMKV, type MMKV } from 'react-native-mmkv';

import type { PerpsProviderId } from '@/config/appConfig';

const ONBOARDING_INTRO_SEEN_KEY = 'onboarding.introSeen.v1';
const PERPS_PROVIDER_KEY = 'perps.provider.v1';

let preferencesStorage: MMKV | null = null;

/**
 * Lazily create the unencrypted, non-sensitive preferences store. Auth/session
 * material, keys, recovery data, and other secrets must never enter this store.
 */
function getPreferencesStorage() {
  preferencesStorage ??= createMMKV({
    id: 'perpal.preferences.v1',
    compareBeforeSet: true,
    recoveryStrategy: 'discard-on-error',
  });

  return preferencesStorage;
}

export function readOnboardingIntroSeen() {
  return getPreferencesStorage().getBoolean(ONBOARDING_INTRO_SEEN_KEY) ?? false;
}

export function writeOnboardingIntroSeen() {
  getPreferencesStorage().set(ONBOARDING_INTRO_SEEN_KEY, true);
}

export function clearOnboardingIntroSeen() {
  getPreferencesStorage().set(ONBOARDING_INTRO_SEEN_KEY, false);
}

export function readPerpsProvider(): PerpsProviderId {
  return getPreferencesStorage().getString(PERPS_PROVIDER_KEY) === 'velocity'
    ? 'velocity'
    : 'pacifica';
}

export function writePerpsProvider(provider: PerpsProviderId): void {
  getPreferencesStorage().set(PERPS_PROVIDER_KEY, provider);
}
