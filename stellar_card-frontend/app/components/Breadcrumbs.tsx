// Breadcrumb navigation. Auto-derives path segments from the current
// pathname and renders them as a trail. Accepts optional overrides for
// segment labels. Compact by default; fits in the dashboard header.

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buildBreadcrumbTrail, type SegmentOverride } from './navigationConfig';

interface Props {
  overrides?: Record<string, SegmentOverride>;
  className?: string;
}

export function Breadcrumbs({ overrides = {}, className }: Props) {
  const pathname = usePathname() || '';
  const trail = buildBreadcrumbTrail(pathname, overrides);

  if (trail.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.3rem',
        fontSize: '0.7rem',
        fontFamily: 'var(--font-mono)',
        color: 'var(--fg-dim)',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        minWidth: 0,
      }}
    >
      {trail.map((item, i) => (
        <span key={item.href} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
          {i > 0 && (
            <span style={{ color: 'var(--fg-dim)', opacity: 0.4, fontSize: '0.6rem' }}>/</span>
          )}
          {item.isLast ? (
            <span style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>{item.label}</span>
          ) : (
            <Link
              href={item.href}
              style={{
                color: 'var(--fg-dim)',
                textDecoration: 'none',
                transition: 'color 0.2s var(--ease-out)',
              }}
            >
              {item.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
