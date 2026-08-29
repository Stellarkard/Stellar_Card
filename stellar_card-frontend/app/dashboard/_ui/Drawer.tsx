// Right-side sliding drawer for modal-ish details (top-up QR, order
// detail, etc). Keyboard-dismissable. No animation yet — Phase 1
// prioritises correctness over polish.

'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  width?: number;
  children: ReactNode;
}

export function Drawer({ open, onClose, title, width = 420, children }: Props) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Move focus to the close button so keyboard users land inside the drawer
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {/* Backdrop — clicking it closes the drawer */}
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.55)',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        style={{
          position: 'relative',
          width,
          maxWidth: '95vw',
          height: '100vh',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 24px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            id={titleId}
            style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--fg)' }}
          >
            {title}
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--fg-dim)',
              width: 26,
              height: 26,
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
            aria-label="Close drawer"
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>{children}</div>
      </div>
    </div>
  );
}
