import { describe, it, expect } from 'vitest';
import { useTheme } from './useTheme';
import { THEME_COLORS, TYPOGRAPHY, SPACING } from './themeConstants';

describe('useTheme', () => {
  it('returns all expected theme constants', () => {
    const theme = useTheme();
    
    expect(theme.colors).toEqual(THEME_COLORS);
    expect(theme.typography).toEqual(TYPOGRAPHY);
    expect(theme.spacing).toEqual(SPACING);
    
    // Verify specific tokens are mapped correctly
    expect(theme.colors.bg).toBe('var(--bg)');
    expect(theme.typography.fontBody).toBe('var(--font-body)');
    expect(theme.spacing.md).toBe('0.75rem');
  });
});
