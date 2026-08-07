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
  readOnboardingIntroSeen,
  writeOnboardingIntroSeen,
} from '@/storage/appPreferences';

type AppPreferences = {
  hasSeenOnboardingIntro: boolean;
  isReady: boolean;
  markOnboardingIntroSeen: () => void;
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

  useEffect(() => {
    let active = true;
    const hasSeenIntro = readOnboardingIntroSeen();
    queueMicrotask(() => {
      if (active) {
        setHasSeenOnboardingIntro(hasSeenIntro);
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

  const value = useMemo(
    () => ({
      hasSeenOnboardingIntro,
      isReady,
      markOnboardingIntroSeen,
    }),
    [
      hasSeenOnboardingIntro,
      isReady,
      markOnboardingIntroSeen,
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
