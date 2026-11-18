import { createContext, useContext } from 'react';

export type Theme = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export interface ThemeProviderState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

// Keep in sync with the inline script in index.html.
export const THEME_STORAGE_KEY = 'proofloop-theme';

export const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

export function useTheme(): ThemeProviderState {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
}
