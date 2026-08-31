'use client';

import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { useFocusTrap } from '../_lib/useFocusTrap';

export type ModalSize = 'sm' | 'md' | 'lg' | 'full';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: ModalSize;
  role?: 'dialog' | 'alertdialog';
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  closeButtonAriaLabel?: string;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

const SIZE_WIDTHS: Record<ModalSize, number | string> = {
  sm: 380,
  md: 480,
  lg: 640,
  full: 'calc(100vw - 2rem)',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  role = 'dialog',
  initialFocusRef,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  closeButtonAriaLabel = 'Close dialog',
  footer,
  className,
  children,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap({
    active: open,
    containerRef: modalRef,
    initialFocusRef,
    onEscape: closeOnEscape ? onClose : undefined,
    restoreFocus: true,
    lockScroll: true,
  });

  if (!open) return null;

  const maxWidth = SIZE_WIDTHS[size];

  return (
    <div
      className={className}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      {/* Backdrop */}
      <div
        role="presentation"
        aria-hidden="true"
        onClick={closeOnBackdropClick ? onClose : undefined}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          transition: 'opacity 150ms ease-out',
        }}
      />

      {/* Modal Dialog Content */}
      <div
        ref={modalRef}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth,
          maxHeight: 'calc(100vh - 2rem)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-hero, 0 16px 48px rgba(0, 0, 0, 0.4))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 101,
          animation: 'fadeInUp 150ms ease-out',
        }}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div
            style={{
              padding: '1rem 1.25rem',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && (
                <h2
                  id={titleId}
                  style={{
                    margin: 0,
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: 'var(--fg)',
                    lineHeight: 1.3,
                  }}
                >
                  {title}
                </h2>
              )}
              {description && (
                <p
                  id={descriptionId}
                  style={{
                    margin: '0.25rem 0 0',
                    fontSize: '0.75rem',
                    color: 'var(--fg-dim)',
                    lineHeight: 1.4,
                  }}
                >
                  {description}
                </p>
              )}
            </div>

            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label={closeButtonAriaLabel}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--fg-dim)',
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1rem',
                  lineHeight: 1,
                  flexShrink: 0,
                  transition: 'background 120ms, color 120ms',
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div
          style={{
            padding: '1.25rem',
            overflowY: 'auto',
            flex: 1,
            color: 'var(--fg)',
            fontSize: '0.82rem',
            lineHeight: 1.5,
          }}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              padding: '0.85rem 1.25rem',
              borderTop: '1px solid var(--border)',
              background: 'var(--surface-2, rgba(255, 255, 255, 0.02))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: '0.5rem',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
