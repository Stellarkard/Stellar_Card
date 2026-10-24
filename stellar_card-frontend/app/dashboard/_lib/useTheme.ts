import { THEME_COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS, SHADOWS, MOTION, Z_INDEX } from './themeConstants';

/**
 * Hook to access centralized theme variables programmatically.
 * Useful for scenarios where CSS variables cannot be directly applied,
 * such as passing colors to canvas charts or third-party libraries.
 */
export function useTheme() {
  return {
    colors: THEME_COLORS,
    typography: TYPOGRAPHY,
    spacing: SPACING,
    borderRadius: BORDER_RADIUS,
    shadows: SHADOWS,
    motion: MOTION,
    zIndex: Z_INDEX,
  };
}
