'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

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
}

export function ResponsiveNav({
  items,
  className,
  onNavigate,
  variant = 'horizontal',
}: ResponsiveNavProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (variant === 'horizontal' && mobileOpen) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      return () => {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
      };
    }
  }, [mobileOpen, variant]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const handleNavClick = (href: string) => {
    onNavigate?.(href);
    setMobileOpen(false);
  };

  const navContent = (
    <div className={`responsive-nav-content responsive-nav-${variant}`}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="responsive-nav-item"
          data-active={isActive(item.href) || undefined}
          onClick={() => handleNavClick(item.href)}
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
      <nav className={`responsive-nav responsive-nav-sidebar ${className || ''}`}>
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
          .responsive-nav-sidebar .responsive-nav-item:hover {
            background: var(--surface-hover);
            color: var(--fg);
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
    <nav className={`responsive-nav responsive-nav-${variant} ${className || ''}`}>
      {variant === 'horizontal' && (
        <>
          {navContent}
          <button
            className="responsive-nav-toggle"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-expanded={mobileOpen}
            aria-label="Menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d={mobileOpen ? 'M5 5L19 19M19 5L5 19' : 'M3 6h18M3 12h18M3 18h18'}
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
          transition: color 0.2s var(--ease-out);
          gap: 0.5rem;
        }
        .responsive-nav-item:hover {
          color: var(--fg);
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
        }
        @media (max-width: 768px) {
          .responsive-nav-horizontal .responsive-nav-toggle {
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .responsive-nav-horizontal .responsive-nav-content {
            display: none;
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            flex-direction: column;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            margin-top: 0.5rem;
            padding: 0.5rem;
            z-index: 40;
          }
          .responsive-nav-horizontal[aria-expanded='true'] .responsive-nav-content {
            display: flex;
          }
        }
      `}</style>
    </nav>
  );
}
