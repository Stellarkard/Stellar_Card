// Plain text input. Matches the dark surfaces of the rest of the UI.
// Prefix/suffix slots are optional for currency units, icons, etc.
//
// A11y (#136):
//   - aria-label / aria-labelledby forwarded for inputs without a
//     visible <label>. Callers should prefer a visible label, but
//     dashboard search / filter inputs often have placeholder-only UX.
//   - aria-describedby forwarded for error or hint text associations.
//   - aria-invalid exposed when the field is in an error state.
//   - Prefix/suffix icons get aria-hidden so they're not read twice.

import type { CSSProperties, InputHTMLAttributes, ReactNode } from 'react';

// React's InputHTMLAttributes declares `prefix: string` which would
// collide with our richer prop — Omit it so we can take ReactNode.
interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  prefix?: ReactNode;
  suffix?: ReactNode;
  wrapperStyle?: CSSProperties;
  /** Associates an external error / hint element with this input. */
  'aria-describedby'?: string;
  /** Marks the field invalid — should be paired with a visible error. */
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}

export function Input({ prefix, suffix, wrapperStyle, style, ...rest }: Props) {
  const ariaLabel = rest['aria-label'];
  const ariaInvalid = rest['aria-invalid'];
  const ariaRequired = rest['aria-required'];
  
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        background: 'var(--surface-2)',
        border: `1px solid ${ariaInvalid ? 'var(--red)' : 'var(--border)'}`,
        borderRadius: 6,
        padding: '0.45rem 0.7rem',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.75rem',
        color: 'var(--fg)',
        ...wrapperStyle,
      }}
    >
      {prefix && <span aria-hidden="true" style={{ color: 'var(--fg-dim)' }}>{prefix}</span>}
      <input
        {...rest}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'inherit',
          font: 'inherit',
          ...style,
        }}
      />
      {suffix && <span aria-hidden="true" style={{ color: 'var(--fg-dim)' }}>{suffix}</span>}
    </div>
  );
}
