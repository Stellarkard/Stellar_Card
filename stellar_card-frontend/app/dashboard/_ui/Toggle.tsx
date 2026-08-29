// Labeled toggle switch with optional description and inline input.
// Matches the Ampersand "setting row" pattern where a toggle, label,
// description and value field sit on one horizontal rhythm.
//
// A11y (#136):
//   - role="switch" + aria-checked expose the toggle state to AT.
//   - aria-label falls back to the string label if provided.
//   - type="button" prevents accidental form submission.
//   - Keyboard: Space/Enter are natively handled by <button>.

import type { ReactNode } from 'react';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode; // inline value, e.g. an Input
  id?: string;
}

export function Toggle({ checked, onChange, label, description, children, id }: Props) {
  const labelId = id ? `${id}-label` : undefined;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export function Toggle({ checked, onChange, label, description, children, ...rest }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.85rem',
        padding: '0.85rem 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-label={typeof label === 'string' ? label : undefined}
        onClick={() => onChange(!checked)}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={rest['aria-label'] || (typeof label === 'string' ? label : 'Toggle switch')}
        aria-describedby={rest['aria-describedby']}
        style={{
          marginTop: 2,
          width: 30,
          height: 16,
          borderRadius: 16,
          border: `1px solid ${checked ? 'var(--green-border)' : 'var(--border)'}`,
          background: checked ? 'var(--green-dim)' : 'var(--surface-2)',
          position: 'relative',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background 120ms, border-color 120ms',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 1,
            left: checked ? 15 : 1,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: checked ? 'var(--bg)' : 'var(--fg-dim)',
            transition: 'left 140ms',
          }}
        />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          id={labelId}
          style={{
            fontSize: '0.78rem',
            fontWeight: 500,
            color: 'var(--fg)',
            lineHeight: 1.4,
          }}
        >
          {label}
        </div>
        {description && (
          <div
            style={{
              fontSize: '0.7rem',
              color: 'var(--fg-dim)',
              marginTop: '0.2rem',
              lineHeight: 1.45,
            }}
          >
            {description}
          </div>
        )}
        {children && <div style={{ marginTop: '0.5rem' }}>{children}</div>}
      </div>
    </div>
  );
}
