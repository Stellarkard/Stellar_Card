// Shared design tokens — single source of truth for tone colour variables
// and repeated typography values across all dashboard UI components.

export type Tone = 'green' | 'red' | 'yellow' | 'blue' | 'purple' | 'neutral';

export const TONE_VARS: Record<Tone, { fg: string; bg: string; border: string }> = {
  green:   { fg: 'var(--green)',    bg: 'var(--green-muted)',  border: 'var(--green-border)'  },
  red:     { fg: 'var(--red)',      bg: 'var(--red-muted)',    border: 'var(--red-border)'    },
  yellow:  { fg: 'var(--yellow)',   bg: 'var(--yellow-muted)', border: 'var(--yellow-border)' },
  blue:    { fg: 'var(--blue)',     bg: 'var(--blue-muted)',   border: 'var(--blue-border)'   },
  purple:  { fg: 'var(--purple)',   bg: 'var(--purple-muted)', border: 'var(--purple-border)' },
  neutral: { fg: 'var(--fg-muted)', bg: 'var(--surface-2)',    border: 'var(--border)'        },
};

export function toneVars(tone: Tone): { fg: string; bg: string; border: string } {
  return TONE_VARS[tone];
}

/**
 * Typography values that appear in two or more dashboard UI components.
 * Use these to keep sizes consistent instead of repeating string literals.
 */
export const typography = {
  /** The mono font stack used for labels, numbers, badges, and pills. */
  fontMono: 'var(--font-mono)',
  size: {
    /** 0.66 rem — KpiTile label row, FilterChip count badge */
    xs:   '0.66rem',
    /** 0.68 rem — KpiTile delta / hint, SpendChart peak label */
    sm:   '0.68rem',
    /** 0.70 rem — Pill badge text, HorizontalBar trailing value, Button (sm) */
    base: '0.7rem',
    /** 0.78 rem — Toast body text, SpendChart empty-state message */
    md:   '0.78rem',
  },
} as const;

/**
 * Spacing scale shared across dashboard UI components. Use these
 * constants instead of magic numbers to keep gaps and paddings
 * consistent across cards, tables, and layout containers.
 */
export const spacing = {
  /** 0.25rem — tight inline gaps (icon + label, badge padding) */
  xs:    '0.25rem',
  /** 0.35rem — compact element spacing (breadcrumb separators) */
  sm:    '0.35rem',
  /** 0.55rem — default card inner gap (between KpiTile rows) */
  md:    '0.55rem',
  /** 0.75rem — comfortable section spacing (between Card children) */
  lg:    '0.75rem',
  /** 1.25rem — page-level gap between major sections */
  xl:    '1.25rem',
  /** 1.5rem — page container top/bottom padding */
  '2xl': '1.5rem',
} as const;
