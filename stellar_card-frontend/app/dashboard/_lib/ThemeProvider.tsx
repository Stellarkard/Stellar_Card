'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useTheme } from './useTheme';

type Theme = ReturnType<typeof useTheme>;

const ThemeContext = createContext<Theme | null>(null);

/**
 * Provides the centralized theme variables via React Context.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Access the ThemeContext from within a ThemeProvider.
 */
export function useThemeContext(): Theme {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return context;
}
