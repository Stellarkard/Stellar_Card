// Centralized theme constants for the Stellar_Card frontend.
// Provides a single source of truth for colors, typography, and spacing
// to ensure consistency across the application.

export const THEME_COLORS = {
  // Canvas + ink
  bg: 'var(--bg)',
  bgElev: 'var(--bg-elev)',
  bgElev2: 'var(--bg-elev-2)',
  fg: 'var(--fg)',
  fgMuted: 'var(--fg-muted)',
  fgDim: 'var(--fg-dim)',
  muted: 'var(--muted)',

  // Surfaces
  surface: 'var(--surface)',
  surface2: 'var(--surface-2)',
  surface3: 'var(--surface-3)',
  surfaceHover: 'var(--surface-hover)',
  border: 'var(--border)',
  borderStrong: 'var(--border-strong)',
  borderHairline: 'var(--border-hairline)',

  // Accents
  green: 'var(--green)',
  greenDim: 'var(--green-dim)',
  greenMuted: 'var(--green-muted)',
  greenBorder: 'var(--green-border)',
  greenGlow: 'var(--green-glow)',

  red: 'var(--red)',
  redMuted: 'var(--red-muted)',
  redBorder: 'var(--red-border)',

  yellow: 'var(--yellow)',
  yellowMuted: 'var(--yellow-muted)',
  yellowBorder: 'var(--yellow-border)',

  blue: 'var(--blue)',
  blueMuted: 'var(--blue-muted)',
  blueBorder: 'var(--blue-border)',

  purple: 'var(--purple)',
  purpleMuted: 'var(--purple-muted)',
  purpleBorder: 'var(--purple-border)',
} as const;

export const TYPOGRAPHY = {
  // Font families
  fontDisplay: 'var(--font-display)',
  fontBody: 'var(--font-body)',
  fontMono: 'var(--font-mono)',

  // Font sizes
  fontSize: {
    xs: '0.64rem',
    sm: '0.7rem',
    base: '0.75rem',
    md: '0.78rem',
    lg: '0.82rem',
    xl: '0.875rem',
    '2xl': '0.95rem',
    '3xl': '1rem',
    '4xl': '1.125rem',
  },

  // Font weights
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  // Line heights
  lineHeight: {
    tight: 1.2,
    normal: 1.4,
    relaxed: 1.5,
    loose: 1.65,
  },

  // Letter spacing
  letterSpacing: {
    tight: '-0.03em',
    normal: '-0.025em',
    wide: '0.01em',
    wider: '0.08em',
    widest: '0.14em',
  },
} as const;

export const SPACING = {
  // Base spacing unit
  base: '0.25rem',

  // Spacing scale
  xs: '0.25rem',
  sm: '0.5rem',
  md: '0.75rem',
  lg: '1rem',
  xl: '1.5rem',
  '2xl': '2rem',
  '3xl': '3rem',
  '4xl': '4rem',
} as const;

export const BORDER_RADIUS = {
  none: '0',
  sm: '4px',
  base: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '24px',
  full: '999px',
} as const;

export const SHADOWS = {
  card: 'var(--shadow-card)',
  hero: 'var(--shadow-hero)',
  float: 'var(--shadow-float)',
} as const;

export const MOTION = {
  easeOut: 'var(--ease-out)',
  easeInOut: 'var(--ease-in-out)',
  easeSpring: 'var(--ease-spring)',
  duration: {
    fast: '120ms',
    normal: '300ms',
    slow: '500ms',
  },
} as const;

export const Z_INDEX = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modalBackdrop: 40,
  modal: 50,
  popover: 60,
  tooltip: 70,
} as const;

// Helper function to get status color classes
export function getStatusColor(status: string): {
  color: string;
  background: string;
  border: string;
} {
  const statusMap: Record<string, { color: string; background: string; border: string }> = {
    pending_payment: {
      color: THEME_COLORS.yellow,
      background: THEME_COLORS.yellowMuted,
      border: THEME_COLORS.yellowBorder,
    },
    payment_confirmed: {
      color: THEME_COLORS.blue,
      background: THEME_COLORS.blueMuted,
      border: THEME_COLORS.blueBorder,
    },
    ordering: {
      color: THEME_COLORS.purple,
      background: THEME_COLORS.purpleMuted,
      border: THEME_COLORS.purpleBorder,
    },
    claim_received: {
      color: THEME_COLORS.purple,
      background: THEME_COLORS.purpleMuted,
      border: THEME_COLORS.purpleBorder,
    },
    stage1_done: {
      color: THEME_COLORS.purple,
      background: THEME_COLORS.purpleMuted,
      border: THEME_COLORS.purpleBorder,
    },
    delivered: {
      color: THEME_COLORS.green,
      background: THEME_COLORS.greenMuted,
      border: THEME_COLORS.greenBorder,
    },
    failed: {
      color: THEME_COLORS.red,
      background: THEME_COLORS.redMuted,
      border: THEME_COLORS.redBorder,
    },
    refund_pending: {
      color: THEME_COLORS.yellow,
      background: THEME_COLORS.yellowMuted,
      border: THEME_COLORS.yellowBorder,
    },
    awaiting_approval: {
      color: THEME_COLORS.purple,
      background: THEME_COLORS.purpleMuted,
      border: THEME_COLORS.purpleBorder,
    },
    awaiting_payment: {
      color: THEME_COLORS.yellow,
      background: THEME_COLORS.yellowMuted,
      border: THEME_COLORS.yellowBorder,
    },
    processing: {
      color: THEME_COLORS.blue,
      background: THEME_COLORS.blueMuted,
      border: THEME_COLORS.blueBorder,
    },
    ready: {
      color: THEME_COLORS.green,
      background: THEME_COLORS.greenMuted,
      border: THEME_COLORS.greenBorder,
    },
    refunded: {
      color: THEME_COLORS.yellow,
      background: THEME_COLORS.yellowMuted,
      border: THEME_COLORS.yellowBorder,
    },
    rejected: {
      color: THEME_COLORS.red,
      background: THEME_COLORS.redMuted,
      border: THEME_COLORS.redBorder,
    },
    expired: {
      color: THEME_COLORS.fgDim,
      background: THEME_COLORS.surface,
      border: THEME_COLORS.borderStrong,
    },
  };

  return (
    statusMap[status] || {
      color: THEME_COLORS.fgDim,
      background: THEME_COLORS.surface,
      border: THEME_COLORS.border,
    }
  );
}
