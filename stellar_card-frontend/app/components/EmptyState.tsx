// Global empty state component. Unified across marketing and dashboard.
// Follows the same visual language as the existing dashboard EmptyState
// but lives in the shared components directory so any route can use it.

import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, compact }: Props) {
  return (
    <div
      style={{
        padding: compact ? '2rem 1.25rem' : '3rem 1.5rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: compact ? '0.5rem' : '0.75rem',
      }}
    >
      {icon && (
        <div
          style={{
            color: 'var(--fg-dim)',
            opacity: 0.5,
            marginBottom: compact ? '0.25rem' : '0.5rem',
          }}
        >
          {icon}
        </div>
      )}
      <div
        style={{
          fontSize: compact ? '0.82rem' : '0.875rem',
          fontWeight: 500,
          color: 'var(--fg)',
          fontFamily: 'var(--font-body)',
        }}
      >
        {title}
      </div>
      {description && (
        <div
          style={{
            fontSize: compact ? '0.72rem' : '0.75rem',
            color: 'var(--fg-dim)',
            maxWidth: 360,
            lineHeight: 1.5,
            fontFamily: 'var(--font-body)',
          }}
        >
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: '0.25rem' }}>{action}</div>}
    </div>
  );
}
