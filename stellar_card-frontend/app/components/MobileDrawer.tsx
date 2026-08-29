// Mobile sidebar drawer. Wraps the dashboard sidebar content in a
// slide-over panel triggered by a hamburger button in the header.
// Uses the existing design tokens and respects reduced motion.

'use client';

import { useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../dashboard/_lib/useFocusTrap';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function MobileDrawer({ open, onClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useFocusTrap({
    active: open,
    containerRef: panelRef,
    initialFocusRef: closeRef,
    onEscape: onClose,
    restoreFocus: true,
    lockScroll: true,
  });

  return (
    <>
      {open && (
        <div
          role="presentation"
          aria-hidden="true"
          className="mobile-drawer-overlay"
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            zIndex: 90,
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          }}
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={open ? 'true' : undefined}
        aria-label="Navigation drawer"
        className={`mobile-drawer${open ? ' mobile-drawer--open' : ''}`}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 260,
          background: 'var(--bg)',
          borderRight: '1px solid var(--border)',
          zIndex: 91,
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 300ms var(--ease-out)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          visibility: open ? 'visible' : 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem 0.5rem',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--fg-dim)',
              padding: '0 0.75rem',
            }}
          >
            Navigation
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            style={{
              width: 32,
              height: 32,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              color: 'var(--fg-dim)',
              cursor: 'pointer',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
          {children}
        </div>
      </div>
    </>
  );
}
