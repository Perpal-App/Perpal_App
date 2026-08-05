import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  readPerpsProvider,
  readOnboardingIntroSeen,
  writePerpsProvider,
  writeOnboardingIntroSeen,
} from '@/storage/appPreferences';
import type { PerpsProviderId } from '@/config/appConfig';

type AppPreferences = {
  hasSeenOnboardingIntro: boolean;
  selectedPerpsProvider: PerpsProviderId;
  isReady: boolean;
  markOnboardingIntroSeen: () => void;
  selectPerpsProvider: (provider: PerpsProviderId) => void;
};

const AppPreferencesContext = createContext<AppPreferences | null>(null);

type AppPreferencesProviderProps = {
  children: ReactNode;
};

/**
 * Loads bounded, non-sensitive MMKV preferences outside render and exposes a
 * React snapshot. This provider is never an authentication authority.
 */
export function AppPreferencesProvider({
  children,
}: AppPreferencesProviderProps) {
  const [hasSeenOnboardingIntro, setHasSeenOnboardingIntro] = useState(false);
  const [selectedPerpsProvider, setSelectedPerpsProvider] =
    useState<PerpsProviderId>('flash');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;
    const hasSeenIntro = readOnboardingIntroSeen();
    const perpsProvider = readPerpsProvider();

    queueMicrotask(() => {
      if (active) {
        setHasSeenOnboardingIntro(hasSeenIntro);
        setSelectedPerpsProvider(perpsProvider);
        setIsReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const markOnboardingIntroSeen = useCallback(() => {
    writeOnboardingIntroSeen();
    setHasSeenOnboardingIntro(true);
  }, []);

  const selectPerpsProvider = useCallback((provider: PerpsProviderId) => {
    writePerpsProvider(provider);
    setSelectedPerpsProvider(provider);
  }, []);

  const value = useMemo(
    () => ({
      hasSeenOnboardingIntro,
      selectedPerpsProvider,
      isReady,
      markOnboardingIntroSeen,
      selectPerpsProvider,
    }),
    [
      hasSeenOnboardingIntro,
      isReady,
      markOnboardingIntroSeen,
      selectedPerpsProvider,
      selectPerpsProvider,
    ],
  );

  return (
    <AppPreferencesContext.Provider value={value}>
      {children}
    </AppPreferencesContext.Provider>
  );
}

export function useAppPreferences() {
  const preferences = useContext(AppPreferencesContext);

  if (preferences === null) {
    throw new Error(
      'useAppPreferences must be used within AppPreferencesProvider.',
    );
  }

  return preferences;
}
