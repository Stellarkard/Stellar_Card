// Right-side sliding drawer for modal-ish details (top-up QR, order
// detail, etc). Keyboard-dismissable with focus trap and ARIA tags.

'use client';

import { useId, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../_lib/useFocusTrap';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  width?: number;
  children: ReactNode;
}

export function Drawer({ open, onClose, title, description, width = 420, children }: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useFocusTrap({
    active: open,
    containerRef: drawerRef,
    initialFocusRef: closeRef,
    onEscape: onClose,
    restoreFocus: true,
    lockScroll: true,
  });

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
        aria-hidden="true"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        }}
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
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
          zIndex: 61,
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
          <div>
            <div
              id={titleId}
              style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--fg)' }}
            >
              {title}
            </div>
            {description && (
              <div
                id={descriptionId}
                style={{ fontSize: '0.72rem', color: 'var(--fg-dim)', marginTop: '0.2rem' }}
              >
                {description}
              </div>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
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
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Close drawer"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>{children}</div>
      </div>
    </div>
  );
}
