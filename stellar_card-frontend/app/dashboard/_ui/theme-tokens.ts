// Standardized UI theme tokens
// Single source of truth for all design system values
// Consolidates colors, typography, spacing, and motion

/**
 * Color palette - references CSS variables defined in globals.css
 */
export const colors = {
  // Canvas & ink
  background: {
    base: 'var(--bg)',
    elevated: 'var(--bg-elev)',
    elevated2: 'var(--bg-elev-2)',
  },
  foreground: {
    base: 'var(--fg)',
    muted: 'var(--fg-muted)',
    dim: 'var(--fg-dim)',
  },
  
  // Surfaces
  surface: {
    base: 'var(--surface)',
    level2: 'var(--surface-2)',
    level3: 'var(--surface-3)',
    hover: 'var(--surface-hover)',
  },
  
  // Borders
  border: {
    base: 'var(--border)',
    strong: 'var(--border-strong)',
    hairline: 'var(--border-hairline)',
  },
  
  // Semantic colors
  semantic: {
    success: {
      base: 'var(--green)',
      dim: 'var(--green-dim)',
      muted: 'var(--green-muted)',
      border: 'var(--green-border)',
      glow: 'var(--green-glow)',
    },
    error: {
      base: 'var(--red)',
      muted: 'var(--red-muted)',
      border: 'var(--red-border)',
    },
    warning: {
      base: 'var(--yellow)',
      muted: 'var(--yellow-muted)',
      border: 'var(--yellow-border)',
    },
    info: {
      base: 'var(--blue)',
      muted: 'var(--blue-muted)',
      border: 'var(--blue-border)',
    },
    neutral: {
      base: 'var(--purple)',
      muted: 'var(--purple-muted)',
      border: 'var(--purple-border)',
    },
  },
} as const;

/**
 * Typography system
 */
export const typography = {
  // Font families
  family: {
    display: 'var(--font-display)',
    body: 'var(--font-body)',
    mono: 'var(--font-mono)',
  },
  
  // Font sizes - rem-based scale
  size: {
    xs: '0.64rem',     // 10.24px at 16px base
    sm: '0.7rem',      // 11.2px
    base: '0.75rem',   // 12px
    md: '0.78rem',     // 12.48px
    lg: '0.82rem',     // 13.12px
    xl: '0.875rem',    // 14px
    '2xl': '0.95rem',  // 15.2px
    '3xl': '1rem',     // 16px
    '4xl': '1.125rem', // 18px
    '5xl': '1.25rem',  // 20px
    '6xl': '1.5rem',   // 24px
  },
  
  // Font weights
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  
  // Line heights
  lineHeight: {
    tight: 0.96,
    snug: 1.2,
    normal: 1.4,
    relaxed: 1.5,
    loose: 1.65,
  },
  
  // Letter spacing
  letterSpacing: {
    tighter: '-0.03em',
    tight: '-0.025em',
    normal: '0em',
    wide: '0.08em',
    wider: '0.14em',
  },
} as const;

/**
 * Spacing system - 4px base unit
 */
export const spacing = {
  px: '1px',
  0: '0',
  0.5: '0.125rem',  // 2px
  1: '0.25rem',     // 4px
  1.5: '0.375rem',  // 6px
  2: '0.5rem',      // 8px
  2.5: '0.625rem',  // 10px
  3: '0.75rem',     // 12px
  3.5: '0.875rem',  // 14px
  4: '1rem',        // 16px
  5: '1.25rem',     // 20px
  6: '1.5rem',      // 24px
  7: '1.75rem',     // 28px
  8: '2rem',        // 32px
  9: '2.25rem',     // 36px
  10: '2.5rem',     // 40px
  12: '3rem',       // 48px
  14: '3.5rem',     // 56px
  16: '4rem',       // 64px
  20: '5rem',       // 80px
  24: '6rem',       // 96px
} as const;

/**
 * Border radius scale
 */
export const borderRadius = {
  none: '0',
  sm: '4px',
  base: '6px',
  md: '8px',
  lg: '10px',
  xl: '12px',
  '2xl': '16px',
  '3xl': '24px',
  full: '9999px',
} as const;

/**
 * Shadow system
 */
export const shadows = {
  card: 'var(--shadow-card)',
  hero: 'var(--shadow-hero)',
  float: 'var(--shadow-float)',
  none: 'none',
} as const;

/**
 * Motion & animation
 */
export const motion = {
  // Easing functions
  easing: {
    out: 'var(--ease-out)',           // cubic-bezier(0.16, 1, 0.3, 1)
    inOut: 'var(--ease-in-out)',      // cubic-bezier(0.77, 0, 0.18, 1)
    spring: 'var(--ease-spring)',     // cubic-bezier(0.34, 1.56, 0.64, 1)
  },
  
  // Duration scale
  duration: {
    instant: '0ms',
    fast: '120ms',
    normal: '300ms',
    slow: '500ms',
    slower: '800ms',
  },
} as const;

/**
 * Z-index scale
 */
export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modalBackdrop: 40,
  modal: 50,
  popover: 60,
  tooltip: 70,
  notification: 80,
} as const;

/**
 * Breakpoints for responsive design
 */
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

/**
 * Component-specific tokens
 */
export const components = {
  button: {
    height: {
      sm: '32px',
      md: '40px',
      lg: '48px',
    },
    padding: {
      sm: '0.5rem 0.875rem',
      md: '0.625rem 1.125rem',
      lg: '0.75rem 1.5rem',
    },
  },
  input: {
    height: {
      sm: '32px',
      md: '40px',
      lg: '48px',
    },
  },
  card: {
    padding: {
      sm: '0.75rem',
      md: '1rem',
      lg: '1.5rem',
      xl: '2rem',
    },
  },
} as const;

/**
 * Helper function to create theme-aware inline styles
 */
export function createStyles<T extends Record<string, React.CSSProperties>>(
  styles: T
): T {
  return styles;
}

/**
 * Type-safe theme token access
 */
export type ThemeColors = typeof colors;
export type ThemeTypography = typeof typography;
export type ThemeSpacing = typeof spacing;
export type ThemeBorderRadius = typeof borderRadius;
export type ThemeShadows = typeof shadows;
export type ThemeMotion = typeof motion;
export type ThemeZIndex = typeof zIndex;
export type ThemeBreakpoints = typeof breakpoints;

// Export consolidated theme object
export const theme = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
  motion,
  zIndex,
  breakpoints,
  components,
} as const;

export type Theme = typeof theme;
