import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { syncNativeStatusBar } from './native-shell';
import { getProfileFirestore, loadProfileSettings, type UserSettings } from './profile-settings';

/**
 * Accessibility preferences are stylesheet-level: `global.css` keys light theme,
 * high contrast, large text, and reduced motion off `html[data-*]` attributes.
 * Applying them from a page effect only worked once that page was visited, so a
 * saved preference silently reverted on every reload that started elsewhere.
 * The provider owns loading and applying them for the whole session instead.
 */
const defaultPreferences: UserSettings = {
  theme: 'system',
  highContrast: false,
  reducedMotion: false,
  fontScale: 'default'
};

type PreferencesContextValue = {
  preferences: UserSettings;
  /** Preview or persist a change immediately, without waiting for a reload. */
  applyPreferences: (next: UserSettings) => void;
};

const PreferencesContext = createContext<PreferencesContextValue>({
  preferences: defaultPreferences,
  applyPreferences: () => undefined
});

function resolvedTheme(theme: UserSettings['theme']): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyPreferencesToDocument(preferences: UserSettings) {
  const root = document.documentElement;
  const theme = resolvedTheme(preferences.theme);
  root.dataset.theme = theme;
  root.dataset.highContrast = String(preferences.highContrast);
  root.dataset.reducedMotion = String(preferences.reducedMotion);
  root.dataset.fontScale = preferences.fontScale;
  void syncNativeStatusBar(theme);
}

type PreferencesProviderProps = {
  children: ReactNode;
};

export function PreferencesProvider({ children }: PreferencesProviderProps) {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserSettings>(defaultPreferences);

  useEffect(() => {
    let current = true;
    if (!user) {
      setPreferences(defaultPreferences);
      return () => { current = false; };
    }
    void loadProfileSettings(getProfileFirestore(), user.uid).then((loaded) => {
      if (current) setPreferences(loaded.preferences);
    }).catch(() => {
      // A preference read that fails must never block the app; the defaults stay.
      if (current) setPreferences(defaultPreferences);
    });
    return () => { current = false; };
  }, [user]);

  useEffect(() => {
    applyPreferencesToDocument(preferences);
    if (preferences.theme !== 'system' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const listener = () => applyPreferencesToDocument(preferences);
    media.addEventListener?.('change', listener);
    return () => media.removeEventListener?.('change', listener);
  }, [preferences]);

  const applyPreferences = useCallback((next: UserSettings) => setPreferences(next), []);
  const value = useMemo(() => ({ preferences, applyPreferences }), [applyPreferences, preferences]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePreferences() {
  return useContext(PreferencesContext);
}
