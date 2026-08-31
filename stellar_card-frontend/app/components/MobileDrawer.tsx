// Mobile sidebar drawer. Wraps the dashboard sidebar content in a
// slide-over panel triggered by a hamburger button in the header.
// Uses the existing design tokens and respects reduced motion.
// Features trap focus when open and properly manages accessibility.

'use client';

import { useEffect, useRef, useCallback } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Optional ARIA label for the drawer */
  ariaLabel?: string;
  /** Width of the drawer in pixels */
  width?: number;
}

export function MobileDrawer({
  open,
  onClose,
  children,
  ariaLabel = 'Navigation drawer',
  width = 260,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<Element | null>(null);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }

      // Trap focus within drawer when open
      if (e.key === 'Tab' && panelRef.current) {
        const focusableElements = panelRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
        const activeElement = document.activeElement;

        if (e.shiftKey) {
          // Shift + Tab
          if (activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab
          if (activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    },
    [onClose]
  );

  // Handle scroll lock and focus management
  useEffect(() => {
    if (!open) {
      // Restore previous focus and scroll
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!prefersReducedMotion) {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
      }
      // Restore focus to the element that opened the drawer
      if (previousActiveElementRef.current && previousActiveElementRef.current instanceof HTMLElement) {
        previousActiveElementRef.current.focus();
      }
      return;
    }

    // Store the element that currently has focus
    previousActiveElementRef.current = document.activeElement;

    // Prevent scroll
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReducedMotion) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }

    // Set initial focus to close button
    setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    // Add keyboard event listener
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  // Handle click outside
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <>
      {open && (
        <div
          className="mobile-drawer-overlay"
          onClick={handleOverlayClick}
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            zIndex: 90,
            transition: 'opacity 300ms var(--ease-out)',
            opacity: open ? 1 : 0,
          }}
        />
      )}
      <div
        ref={panelRef}
        className={`mobile-drawer${open ? ' mobile-drawer--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width,
          background: 'var(--bg)',
          borderRight: '1px solid var(--border)',
          zIndex: 91,
          transform: open ? 'translateX(0)' : `translateX(-${width}px)`,
          transition: 'transform 300ms var(--ease-out)',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.75rem 0.5rem',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
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
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close navigation drawer"
            type="button"
            style={{
              width: 32,
              height: 32,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              transition: 'background 0.2s var(--ease-out), border-color 0.2s var(--ease-out)',
              padding: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-strong)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M3 3L13 13M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div style={{ flex: 1, padding: '0.5rem', overflowY: 'auto' }}>{children}</div>
      </div>
    </>
  );
}
