import { describe, it, expect } from 'vitest';
import {
  darkTheme,
  lightTheme,
  getTheme,
  themeToCSSProperties,
  type Theme,
} from './themeConfig';

describe('themeConfig', () => {
  describe('theme objects', () => {
    it('should have dark theme with correct structure', () => {
      expect(darkTheme.name).toBe('dark');
      expect(darkTheme.colors).toBeDefined();
      expect(darkTheme.typography).toBeDefined();
      expect(darkTheme.spacing).toBeDefined();
      expect(darkTheme.shadows).toBeDefined();
      expect(darkTheme.motion).toBeDefined();
    });

    it('should have light theme with correct structure', () => {
      expect(lightTheme.name).toBe('light');
      expect(lightTheme.colors).toBeDefined();
      expect(lightTheme.typography).toBeDefined();
      expect(lightTheme.spacing).toBeDefined();
      expect(lightTheme.shadows).toBeDefined();
      expect(lightTheme.motion).toBeDefined();
    });

    it('should have different background colors for dark and light themes', () => {
      expect(darkTheme.colors.bg).not.toBe(lightTheme.colors.bg);
      expect(darkTheme.colors.fg).not.toBe(lightTheme.colors.fg);
    });

    it('should have consistent spacing values across themes', () => {
      expect(darkTheme.spacing.md).toBe(lightTheme.spacing.md);
      expect(darkTheme.spacing.lg).toBe(lightTheme.spacing.lg);
    });
  });

  describe('getTheme', () => {
    it('should return dark theme when name is "dark"', () => {
      const theme = getTheme('dark');
      expect(theme.name).toBe('dark');
      expect(theme).toEqual(darkTheme);
    });

    it('should return light theme when name is "light"', () => {
      const theme = getTheme('light');
      expect(theme.name).toBe('light');
      expect(theme).toEqual(lightTheme);
    });
  });

  describe('themeToCSSProperties', () => {
    it('should convert theme to CSS custom properties', () => {
      const cssProps = themeToCSSProperties(darkTheme);
      
      expect(cssProps['--bg']).toBe(darkTheme.colors.bg);
      expect(cssProps['--fg']).toBe(darkTheme.colors.fg);
      expect(cssProps['--green']).toBe(darkTheme.colors.green);
    });

    it('should include all color variables', () => {
      const cssProps = themeToCSSProperties(darkTheme);
      
      expect(cssProps).toHaveProperty('--bg');
      expect(cssProps).toHaveProperty('--border');
      expect(cssProps).toHaveProperty('--green');
      expect(cssProps).toHaveProperty('--red');
      expect(cssProps).toHaveProperty('--blue');
    });

    it('should include typography variables', () => {
      const cssProps = themeToCSSProperties(darkTheme);
      
      expect(cssProps).toHaveProperty('--font-display');
      expect(cssProps).toHaveProperty('--font-body');
      expect(cssProps).toHaveProperty('--font-mono');
    });

    it('should include spacing variables', () => {
      const cssProps = themeToCSSProperties(darkTheme);
      
      expect(cssProps).toHaveProperty('--spacing-xs');
      expect(cssProps).toHaveProperty('--spacing-md');
      expect(cssProps).toHaveProperty('--spacing-xl');
    });

    it('should include shadow variables', () => {
      const cssProps = themeToCSSProperties(darkTheme);
      
      expect(cssProps).toHaveProperty('--shadow-card');
      expect(cssProps).toHaveProperty('--shadow-hero');
      expect(cssProps).toHaveProperty('--shadow-float');
    });

    it('should include motion variables', () => {
      const cssProps = themeToCSSProperties(darkTheme);
      
      expect(cssProps).toHaveProperty('--ease-out');
      expect(cssProps).toHaveProperty('--ease-in-out');
      expect(cssProps).toHaveProperty('--ease-spring');
    });
  });

  describe('theme consistency', () => {
    it('should have matching structure between dark and light themes', () => {
      const darkKeys = Object.keys(darkTheme.colors).sort();
      const lightKeys = Object.keys(lightTheme.colors).sort();
      
      expect(darkKeys).toEqual(lightKeys);
    });

    it('should have valid color values', () => {
      const colorRegex = /^(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))$/;
      
      Object.values(darkTheme.colors).forEach((color) => {
        expect(color).toMatch(colorRegex);
      });
      
      Object.values(lightTheme.colors).forEach((color) => {
        expect(color).toMatch(colorRegex);
      });
    });

    it('should have valid spacing values in rem', () => {
      const spacingRegex = /^\d+(\.\d+)?rem$/;
      
      Object.values(darkTheme.spacing).forEach((spacing) => {
        expect(spacing).toMatch(spacingRegex);
      });
    });
  });
});
