// Breadcrumb navigation. Auto-derives path segments from the current
// pathname and renders them as a trail. Accepts optional overrides for
// segment labels. Compact by default; fits in the dashboard header.

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SegmentOverride {
  label: string;
  href?: string;
}

interface Props {
  overrides?: Record<string, SegmentOverride>;
  className?: string;
}

const LABEL_MAP: Record<string, string> = {
  dashboard: 'Dashboard',
  overview: 'Overview',
  agents: 'Agents',
  orders: 'Orders',
  approvals: 'Approvals',
  analytics: 'Analytics',
  merchants: 'Merchants',
  developer: 'Developer',
  webhooks: 'Webhooks',
  alerts: 'Alerts',
  audit: 'Audit log',
  teams: 'Teams',
  settings: 'Settings',
  feedback: 'Feedback',
  platform: 'Platform',
  users: 'All users',
  treasury: 'Treasury',
  margins: 'Margins',
  unmatched: 'Unmatched',
  health: 'Health',
};

export function Breadcrumbs({ overrides = {}, className }: Props) {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length <= 1) return null;

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
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;
        const href = '/' + segments.slice(0, i + 1).join('/');
        const override = overrides[segment];
        const label = override?.label || LABEL_MAP[segment] || segment;
        const linkHref = override?.href || href;

        return (
          <span key={href} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            {i > 0 && (
              <span style={{ color: 'var(--fg-dim)', opacity: 0.4, fontSize: '0.6rem' }}>/</span>
            )}
            {isLast ? (
              <span style={{ color: 'var(--fg-muted)', fontWeight: 500 }}>{label}</span>
            ) : (
              <Link
                href={linkHref}
                style={{
                  color: 'var(--fg-dim)',
                  textDecoration: 'none',
                  transition: 'color 0.2s var(--ease-out)',
                }}
              >
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
