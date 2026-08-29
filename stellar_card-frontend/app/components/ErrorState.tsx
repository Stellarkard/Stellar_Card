// Global error state component. Renders a recoverable error card with
// optional retry action. Used inside ErrorBoundaries and as a standalone
// fallback in pages that catch their own errors.

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

interface Props {
  title?: string;
  message?: string;
  digest?: string;
  onRetry?: () => void;
  action?: ReactNode;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again.',
  digest,
  onRetry,
  action,
}: Props) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = useCallback(() => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      onRetry();
    } finally {
      setRetrying(false);
    }
  }, [onRetry]);

  return (
    <div
      style={{
        padding: '3rem 1.5rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: '0.75rem',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'var(--red-muted)',
          border: '1px solid var(--red-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '0.25rem',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--red)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div
        style={{
          fontSize: '0.875rem',
          fontWeight: 500,
          color: 'var(--fg)',
          fontFamily: 'var(--font-body)',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: '0.75rem',
          color: 'var(--fg-dim)',
          maxWidth: 340,
          lineHeight: 1.5,
          fontFamily: 'var(--font-body)',
        }}
      >
        {message}
      </div>
      {digest && (
        <code
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.68rem',
            color: 'var(--fg-dim)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '0.15em 0.5em',
            marginTop: '0.15rem',
          }}
        >
          {digest}
        </code>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
        {onRetry && (
          <button
            onClick={handleRetry}
            disabled={retrying}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 0.85rem',
              borderRadius: 6,
              background: 'var(--green-muted)',
              color: 'var(--green)',
              border: '1px solid var(--green-border)',
              cursor: retrying ? 'wait' : 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600,
              fontFamily: 'var(--font-mono)',
              opacity: retrying ? 0.6 : 1,
              transition: 'opacity 120ms',
            }}
          >
            {retrying ? 'Retrying…' : 'Try again'}
          </button>
        )}
        {action}
      </div>
    </div>
  );
}
