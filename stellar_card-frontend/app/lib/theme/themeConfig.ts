/**
 * Standardized UI theme configuration
 * Part 1: Core theme variables (colors, typography, spacing)
 * Centralizes all design tokens for consistent application theming
 */

export interface ThemeColors {
  // Canvas + ink
  bg: string;
  bgElev: string;
  bgElev2: string;
  fg: string;
  fgMuted: string;
  fgDim: string;
  muted: string;

  // Surfaces
  surface: string;
  surface2: string;
  surface3: string;
  surfaceHover: string;
  border: string;
  borderStrong: string;
  borderHairline: string;

  // Accents
  green: string;
  greenDim: string;
  greenMuted: string;
  greenBorder: string;
  greenGlow: string;
  red: string;
  redMuted: string;
  redBorder: string;
  yellow: string;
  yellowMuted: string;
  yellowBorder: string;
  blue: string;
  blueMuted: string;
  blueBorder: string;
  purple: string;
  purpleMuted: string;
  purpleBorder: string;
}

export interface ThemeTypography {
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
}

export interface ThemeSpacing {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
  '3xl': string;
  '4xl': string;
}

export interface ThemeShadows {
  card: string;
  hero: string;
  float: string;
}

export interface ThemeMotion {
  easeOut: string;
  easeInOut: string;
  easeSpring: string;
}

export interface Theme {
  name: 'dark' | 'light';
  colors: ThemeColors;
  typography: ThemeTypography;
  spacing: ThemeSpacing;
  shadows: ThemeShadows;
  motion: ThemeMotion;
}

/**
 * Dark theme configuration (default)
 */
export const darkTheme: Theme = {
  name: 'dark',
  colors: {
    bg: '#050505',
    bgElev: '#0c0c0c',
    bgElev2: '#111111',
    fg: '#f4f4f4',
    fgMuted: 'rgba(255, 255, 255, 0.66)',
    fgDim: 'rgba(255, 255, 255, 0.44)',
    muted: 'rgba(255, 255, 255, 0.44)',

    surface: '#0c0c0c',
    surface2: '#141414',
    surface3: '#1a1a1a',
    surfaceHover: 'rgba(255, 255, 255, 0.04)',
    border: 'rgba(255, 255, 255, 0.08)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    borderHairline: 'rgba(255, 255, 255, 0.05)',

    green: '#7cffb2',
    greenDim: '#4fd894',
    greenMuted: 'rgba(124, 255, 178, 0.1)',
    greenBorder: 'rgba(124, 255, 178, 0.26)',
    greenGlow: 'rgba(124, 255, 178, 0.35)',
    red: '#ff7a7a',
    redMuted: 'rgba(255, 122, 122, 0.12)',
    redBorder: 'rgba(255, 122, 122, 0.26)',
    yellow: '#ffd166',
    yellowMuted: 'rgba(255, 209, 102, 0.12)',
    yellowBorder: 'rgba(255, 209, 102, 0.26)',
    blue: '#8ab4ff',
    blueMuted: 'rgba(138, 180, 255, 0.12)',
    blueBorder: 'rgba(138, 180, 255, 0.26)',
    purple: '#c8a8ff',
    purpleMuted: 'rgba(200, 168, 255, 0.12)',
    purpleBorder: 'rgba(200, 168, 255, 0.26)',
  },
  typography: {
    fontDisplay: "'Fraunces', 'IBM Plex Serif', Georgia, 'Times New Roman', serif",
    fontBody: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    fontMono: "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace",
  },
  spacing: {
    xs: '0.25rem',    // 4px
    sm: '0.5rem',     // 8px
    md: '1rem',       // 16px
    lg: '1.5rem',     // 24px
    xl: '2rem',       // 32px
    '2xl': '3rem',    // 48px
    '3xl': '4rem',    // 64px
    '4xl': '6rem',    // 96px
  },
  shadows: {
    card: '0 1px 2px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03)',
    hero: '0 40px 120px -40px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.04)',
    float: '0 20px 48px -24px rgba(0, 0, 0, 0.85)',
  },
  motion: {
    easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
    easeInOut: 'cubic-bezier(0.77, 0, 0.18, 1)',
    easeSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
};

/**
 * Light theme configuration
 */
export const lightTheme: Theme = {
  name: 'light',
  colors: {
    bg: '#fafaf7',
    bgElev: '#ffffff',
    bgElev2: '#f2f1ec',
    fg: '#0a0a0a',
    fgMuted: 'rgba(10, 10, 10, 0.68)',
    fgDim: 'rgba(10, 10, 10, 0.46)',
    muted: 'rgba(10, 10, 10, 0.5)',

    surface: '#ffffff',
    surface2: '#f4f3ef',
    surface3: '#eceae3',
    surfaceHover: 'rgba(10, 10, 10, 0.03)',
    border: 'rgba(10, 10, 10, 0.09)',
    borderStrong: 'rgba(10, 10, 10, 0.16)',
    borderHairline: 'rgba(10, 10, 10, 0.05)',

    green: '#059669',
    greenDim: '#047857',
    greenMuted: 'rgba(5, 150, 105, 0.1)',
    greenBorder: 'rgba(5, 150, 105, 0.26)',
    greenGlow: 'rgba(5, 150, 105, 0.18)',
    red: '#dc2626',
    redMuted: 'rgba(220, 38, 38, 0.08)',
    redBorder: 'rgba(220, 38, 38, 0.22)',
    yellow: '#d97706',
    yellowMuted: 'rgba(217, 119, 6, 0.08)',
    yellowBorder: 'rgba(217, 119, 6, 0.22)',
    blue: '#2563eb',
    blueMuted: 'rgba(37, 99, 235, 0.08)',
    blueBorder: 'rgba(37, 99, 235, 0.22)',
    purple: '#7c3aed',
    purpleMuted: 'rgba(124, 58, 237, 0.08)',
    purpleBorder: 'rgba(124, 58, 237, 0.22)',
  },
  typography: {
    fontDisplay: "'Fraunces', 'IBM Plex Serif', Georgia, 'Times New Roman', serif",
    fontBody: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    fontMono: "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace",
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
    '3xl': '4rem',
    '4xl': '6rem',
  },
  shadows: {
    card: '0 1px 2px rgba(10, 10, 10, 0.06), 0 0 0 1px rgba(10, 10, 10, 0.03)',
    hero: '0 40px 120px -40px rgba(10, 10, 10, 0.22), 0 0 0 1px rgba(10, 10, 10, 0.06)',
    float: '0 20px 48px -24px rgba(10, 10, 10, 0.2)',
  },
  motion: {
    easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
    easeInOut: 'cubic-bezier(0.77, 0, 0.18, 1)',
    easeSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
};

/**
 * Get theme by name
 */
export function getTheme(name: 'dark' | 'light'): Theme {
  return name === 'light' ? lightTheme : darkTheme;
}

/**
 * Generate CSS custom properties from theme object
 */
export function themeToCSSProperties(theme: Theme): Record<string, string> {
  const { colors, typography, spacing, shadows, motion } = theme;
  
  return {
    // Colors
    '--bg': colors.bg,
    '--bg-elev': colors.bgElev,
    '--bg-elev-2': colors.bgElev2,
    '--fg': colors.fg,
    '--fg-muted': colors.fgMuted,
    '--fg-dim': colors.fgDim,
    '--muted': colors.muted,
    '--surface': colors.surface,
    '--surface-2': colors.surface2,
    '--surface-3': colors.surface3,
    '--surface-hover': colors.surfaceHover,
    '--border': colors.border,
    '--border-strong': colors.borderStrong,
    '--border-hairline': colors.borderHairline,
    '--green': colors.green,
    '--green-dim': colors.greenDim,
    '--green-muted': colors.greenMuted,
    '--green-border': colors.greenBorder,
    '--green-glow': colors.greenGlow,
    '--red': colors.red,
    '--red-muted': colors.redMuted,
    '--red-border': colors.redBorder,
    '--yellow': colors.yellow,
    '--yellow-muted': colors.yellowMuted,
    '--yellow-border': colors.yellowBorder,
    '--blue': colors.blue,
    '--blue-muted': colors.blueMuted,
    '--blue-border': colors.blueBorder,
    '--purple': colors.purple,
    '--purple-muted': colors.purpleMuted,
    '--purple-border': colors.purpleBorder,
    
    // Typography
    '--font-display': typography.fontDisplay,
    '--font-body': typography.fontBody,
    '--font-mono': typography.fontMono,
    
    // Spacing
    '--spacing-xs': spacing.xs,
    '--spacing-sm': spacing.sm,
    '--spacing-md': spacing.md,
    '--spacing-lg': spacing.lg,
    '--spacing-xl': spacing.xl,
    '--spacing-2xl': spacing['2xl'],
    '--spacing-3xl': spacing['3xl'],
    '--spacing-4xl': spacing['4xl'],
    
    // Shadows
    '--shadow-card': shadows.card,
    '--shadow-hero': shadows.hero,
    '--shadow-float': shadows.float,
    
    // Motion
    '--ease-out': motion.easeOut,
    '--ease-in-out': motion.easeInOut,
    '--ease-spring': motion.easeSpring,
  };
}
