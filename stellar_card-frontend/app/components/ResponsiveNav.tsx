'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { ReactNode, KeyboardEvent } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon?: ReactNode;
  description?: string;
}

interface ResponsiveNavProps {
  items: NavItem[];
  className?: string;
  onNavigate?: (href: string) => void;
  variant?: 'horizontal' | 'vertical' | 'sidebar';
  /** Enable keyboard navigation (arrow keys, enter, escape) */
  enableKeyboardNav?: boolean;
}

export function ResponsiveNav({
  items,
  className,
  onNavigate,
  variant = 'horizontal',
  enableKeyboardNav = true,
}: ResponsiveNavProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const navItemsRef = useRef<(HTMLAnchorElement | null)[]>([]);

  // Handle scroll lock on mobile menu open
  useEffect(() => {
    if (variant === 'horizontal' && mobileOpen) {
      // Check for reduced motion preference
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!prefersReducedMotion) {
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      }
      return () => {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
      };
    }
  }, [mobileOpen, variant]);

  // Close menu on route change
  useEffect(() => {
    setMobileOpen(false);
    setFocusedIndex(null);
  }, [pathname]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!enableKeyboardNav || variant === 'sidebar') return;

      switch (e.key) {
        case 'Escape':
          setMobileOpen(false);
          toggleRef.current?.focus();
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev === null ? 0 : Math.min(prev + 1, items.length - 1)
          );
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault();
          setFocusedIndex((prev) =>
            prev === null ? items.length - 1 : Math.max(prev - 1, 0)
          );
          break;
        case 'Home':
          e.preventDefault();
          setFocusedIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setFocusedIndex(items.length - 1);
          break;
      }
    },
    [enableKeyboardNav, items.length, variant]
  );

  // Focus management for keyboard navigation
  useEffect(() => {
    if (focusedIndex !== null && navItemsRef.current[focusedIndex]) {
      navItemsRef.current[focusedIndex]?.focus();
    }
  }, [focusedIndex]);

  // Handle click outside to close menu
  useEffect(() => {
    if (!mobileOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        toggleRef.current &&
        !toggleRef.current.contains(e.target as Node)
      ) {
        setMobileOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const handleNavClick = useCallback(
    (href: string) => {
      onNavigate?.(href);
      setMobileOpen(false);
      setFocusedIndex(null);
    },
    [onNavigate]
  );

  const navContent = (
    <div
      className={`responsive-nav-content responsive-nav-${variant}`}
      onKeyDown={handleKeyDown}
      role="menubar"
      aria-label="Navigation"
    >
      {items.map((item, index) => (
        <Link
          key={item.href}
          href={item.href}
          ref={(el) => {
            navItemsRef.current[index] = el;
          }}
          className="responsive-nav-item"
          data-active={isActive(item.href) || undefined}
          onClick={() => handleNavClick(item.href)}
          role="menuitem"
          aria-current={isActive(item.href) ? 'page' : undefined}
        >
          {item.icon && <div className="responsive-nav-icon">{item.icon}</div>}
          <div className="responsive-nav-text">
            <div className="responsive-nav-label">{item.label}</div>
            {item.description && (
              <div className="responsive-nav-description">{item.description}</div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );

  if (variant === 'sidebar') {
    return (
      <nav
        className={`responsive-nav responsive-nav-sidebar ${className || ''}`}
        ref={menuRef}
        role="navigation"
        aria-label="Sidebar navigation"
      >
        {navContent}
        <style>{`
          .responsive-nav-sidebar {
            width: 100%;
          }
          @media (min-width: 768px) {
            .responsive-nav-sidebar {
              width: 240px;
              position: sticky;
              top: 64px;
              height: calc(100vh - 64px);
              overflow-y: auto;
              border-right: 1px solid var(--border);
              padding: 1rem 0;
            }
          }
          .responsive-nav-sidebar .responsive-nav-content {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
          }
          .responsive-nav-sidebar .responsive-nav-item {
            padding: 0.6rem 1rem;
            text-decoration: none;
            color: var(--fg-muted);
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-size: 0.875rem;
            transition: background 0.2s var(--ease-out), color 0.2s var(--ease-out);
            border-radius: 6px;
            margin: 0 0.5rem;
          }
          .responsive-nav-sidebar .responsive-nav-item:hover,
          .responsive-nav-sidebar .responsive-nav-item:focus-visible {
            background: var(--surface-hover);
            color: var(--fg);
            outline: none;
          }
          .responsive-nav-sidebar .responsive-nav-item[data-active] {
            background: var(--green-muted);
            color: var(--green);
          }
        `}</style>
      </nav>
    );
  }

  return (
    <nav
      className={`responsive-nav responsive-nav-${variant} ${className || ''}`}
      ref={menuRef}
      role="navigation"
      aria-label="Main navigation"
    >
      {variant === 'horizontal' && (
        <>
          {navContent}
          <button
            ref={toggleRef}
            className="responsive-nav-toggle"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-expanded={mobileOpen}
            aria-label="Toggle menu"
            aria-controls="responsive-nav-menu"
            type="button"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d={
                  mobileOpen
                    ? 'M5 5L19 19M19 5L5 19'
                    : 'M3 6h18M3 12h18M3 18h18'
                }
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          {mobileOpen && (
            <div
              className="responsive-nav-mobile-overlay"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                zIndex: 39,
              }}
            />
          )}
        </>
      )}

      <style>{`
        .responsive-nav {
          display: flex;
          align-items: center;
          gap: 0.1rem;
          position: relative;
        }
        .responsive-nav-content {
          display: flex;
          align-items: center;
          gap: 0.1rem;
        }
        .responsive-nav-item {
          display: flex;
          align-items: center;
          padding: 0.5rem 0.75rem;
          text-decoration: none;
          color: var(--fg-muted);
          font-size: 0.875rem;
          border-radius: 6px;
          white-space: nowrap;
          transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out);
          gap: 0.5rem;
        }
        .responsive-nav-item:hover,
        .responsive-nav-item:focus-visible {
          color: var(--fg);
          background: var(--surface-hover);
          outline: none;
        }
        .responsive-nav-item[data-active] {
          color: var(--fg);
          background: var(--surface-hover);
        }
        .responsive-nav-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          flex-shrink: 0;
        }
        .responsive-nav-text {
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
        }
        .responsive-nav-label {
          font-weight: 500;
        }
        .responsive-nav-description {
          font-size: 0.75rem;
          color: var(--fg-dim);
        }
        .responsive-nav-toggle {
          display: none;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.5rem;
          cursor: pointer;
          color: var(--fg);
          margin-left: 0.5rem;
          transition: background 0.2s var(--ease-out), border-color 0.2s var(--ease-out);
        }
        .responsive-nav-toggle:hover,
        .responsive-nav-toggle:focus-visible {
          background: var(--surface-hover);
          border-color: var(--border-strong);
          outline: none;
        }

        /* ---- Mobile layout (≤ 768px) ---- */
        @media (max-width: 768px) {
          .responsive-nav-horizontal .responsive-nav-toggle {
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .responsive-nav-horizontal .responsive-nav-content {
            display: none;
            position: fixed;
            top: 64px;
            left: 0;
            right: 0;
            bottom: 0;
            flex-direction: column;
            background: var(--bg);
            padding: 1rem;
            z-index: 40;
            overflow-y: auto;
            overscroll-behavior: contain;
          }
          .responsive-nav-horizontal[aria-expanded='true'] .responsive-nav-content {
            display: flex;
          }
          .responsive-nav-horizontal .responsive-nav-item {
            padding: 1rem;
            font-size: 1rem;
            border-bottom: 1px solid var(--border);
            border-radius: 0;
            gap: 0.75rem;
          }
          .responsive-nav-horizontal .responsive-nav-item:last-child {
            border-bottom: none;
          }
        }

        /* Reduced motion support */
        @media (prefers-reduced-motion: reduce) {
          .responsive-nav-item,
          .responsive-nav-toggle {
            transition: none;
          }
        }
      `}</style>
    </nav>
  );
}
