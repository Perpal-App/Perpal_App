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
  clearOnboardingIntroSeen,
  readOnboardingIntroSeen,
  readPerpsProvider,
  writePerpsProvider,
  writeOnboardingIntroSeen,
} from '@/storage/appPreferences';
import type { PerpsProviderId } from '@/config/appConfig';

type AppPreferences = {
  hasSeenOnboardingIntro: boolean;
  isReady: boolean;
  perpsProvider: PerpsProviderId;
  markOnboardingIntroSeen: () => void;
  showOnboardingIntro: () => void;
  setPerpsProvider: (provider: PerpsProviderId) => void;
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
  const [isReady, setIsReady] = useState(false);
  const [perpsProvider, setPerpsProviderState] = useState<PerpsProviderId>('pacifica');

  useEffect(() => {
    let active = true;
    const hasSeenIntro = readOnboardingIntroSeen();
    const storedPerpsProvider = readPerpsProvider();
    queueMicrotask(() => {
      if (active) {
        setHasSeenOnboardingIntro(hasSeenIntro);
        setPerpsProviderState(storedPerpsProvider);
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

  const showOnboardingIntro = useCallback(() => {
    clearOnboardingIntroSeen();
    setHasSeenOnboardingIntro(false);
  }, []);

  const setPerpsProvider = useCallback((provider: PerpsProviderId) => {
    writePerpsProvider(provider);
    setPerpsProviderState(provider);
  }, []);

  const value = useMemo(
    () => ({
      hasSeenOnboardingIntro,
      isReady,
      markOnboardingIntroSeen,
      perpsProvider,
      setPerpsProvider,
      showOnboardingIntro,
    }),
    [
      hasSeenOnboardingIntro,
      isReady,
      markOnboardingIntroSeen,
      perpsProvider,
      setPerpsProvider,
      showOnboardingIntro,
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
