// Minimal button primitive. Four variants:
//   primary    — subtle green chip (matches the live indicator), used
//                for the highest-emphasis CTA in a region
//   secondary  — bordered surface, used for everything that isn't a
//                primary or destructive action
//   ghost      — transparent / text-only
//   danger     — red-muted, used for destructive actions
//
// Bright #00ff88 fills are deliberately avoided — they read as
// "hackathon" rather than "enterprise". The Live indicator's tone is
// the green we use everywhere now.
//
// A11y (#136):
//   - Explicit type="button" prevents accidental form submission.
//   - aria-disabled mirrors the disabled prop for AT that reads
//     aria attributes rather than the HTML attribute.
//   - aria-label passthrough lets icon-only buttons be annotated
//     by the caller.

import type { CSSProperties, ReactNode, ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  children?: ReactNode;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  style,
  type = 'button',
  disabled,
  'aria-label': ariaLabel,
  ...rest
}: Props) {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.4rem',
    fontFamily: 'var(--font-mono)',
    fontSize: size === 'sm' ? '0.7rem' : '0.75rem',
    fontWeight: 600,
    letterSpacing: '0.01em',
    padding: size === 'sm' ? '0.35rem 0.65rem' : '0.5rem 0.85rem',
    borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background 120ms, border-color 120ms, color 120ms',
    lineHeight: 1,
    whiteSpace: 'nowrap',
    opacity: disabled ? 0.5 : 1,
  };
  const variants: Record<Variant, CSSProperties> = {
    primary: {
      background: 'var(--green-muted)',
      color: 'var(--green)',
      border: '1px solid var(--green-border)',
    },
    secondary: {
      background: 'var(--surface)',
      color: 'var(--fg)',
      border: '1px solid var(--border)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--fg-muted)',
      border: '1px solid transparent',
    },
    danger: {
      background: 'var(--red-muted)',
      color: 'var(--red)',
      border: '1px solid var(--red-border)',
    },
  };
  const ariaLabel = rest['aria-label'] || (typeof children === 'string' ? children : undefined);
  
  return (
    <button
      {...rest}
      // Explicit type prevents accidental form submission.
      type={type}
      disabled={disabled}
      aria-disabled={disabled}
      // Allow callers to annotate icon-only buttons.
      aria-label={ariaLabel}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {icon ? <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span> : null}
    <button 
      {...rest} 
      aria-label={ariaLabel}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {icon && <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>}
      {children}
    </button>
  );
}
