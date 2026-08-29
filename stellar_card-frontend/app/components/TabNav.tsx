// Horizontal tab navigation. Used for sub-sections within a dashboard
// page (e.g., overview tabs, settings tabs). Collapses to a scrollable
// strip on narrow viewports.

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState, useEffect } from 'react';

interface Tab {
  href: string;
  label: string;
  badge?: number;
}

interface Props {
  tabs: Tab[];
  className?: string;
}

export function TabNav({ tabs, className }: Props) {
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function checkScroll() {
      setShowLeftFade(el!.scrollLeft > 4);
      setShowRightFade(el!.scrollLeft < el!.scrollWidth - el!.clientWidth - 4);
    }

    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {showLeftFade && <div className="tab-fade tab-fade--left" />}
      {showRightFade && <div className="tab-fade tab-fade--right" />}
      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          gap: 0,
          overflowX: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.href}
              href={tab.href}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.65rem 0.85rem',
                fontSize: '0.75rem',
                fontWeight: active ? 600 : 500,
                fontFamily: 'var(--font-body)',
                color: active ? 'var(--fg)' : 'var(--fg-muted)',
                textDecoration: 'none',
                borderBottom: active
                  ? '2px solid var(--green)'
                  : '2px solid transparent',
                whiteSpace: 'nowrap',
                transition: 'color 120ms, border-color 120ms',
                flexShrink: 0,
              }}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span
                  style={{
                    minWidth: 16,
                    height: 16,
                    padding: '0 4px',
                    borderRadius: 8,
                    background: active ? 'var(--green-muted)' : 'var(--surface-2)',
                    color: active ? 'var(--green)' : 'var(--fg-dim)',
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px solid ${active ? 'var(--green-border)' : 'var(--border)'}`,
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <TabStyles />
    </div>
  );
}

function TabStyles() {
  return (
    <style>{`
      .tab-fade {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 32px;
        pointer-events: none;
        z-index: 1;
      }
      .tab-fade--left {
        left: 0;
        background: linear-gradient(to right, var(--bg), transparent);
      }
      .tab-fade--right {
        right: 0;
        background: linear-gradient(to left, var(--bg), transparent);
      }
      div::-webkit-scrollbar { display: none; }
    `}</style>
  );
}
