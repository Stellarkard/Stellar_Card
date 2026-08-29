// Core configuration and pure helpers for the responsive navigation
// system (Part 2 of the navigation roadmap).
//
// Part 1 introduced the navigation components and Part 3 added the
// sidebar/drawer variants. This module consolidates the values that were
// previously duplicated across those components — active-path matching,
// viewport breakpoints, breadcrumb labels, and marketing nav items — into
// a single typed source of truth so the shared behavior stays consistent
// and can be tuned in one place.

/** Shared viewport breakpoints (px) used across the navigation system. */
export const NAV_BREAKPOINTS = {
  /** Marketing nav collapses to a hamburger menu below this width. */
  mobile: 640,
  /** Marketing nav expands the primary links / "More" dropdown above this width. */
  tablet: 860,
  /** Dashboard switches from drawer to sticky sidebar above this width. */
  sidebar: 768,
} as const;

/**
 * Whether a route is the active one for a given link. Matches the exact
 * path or any nested path under it.
 *
 * @example isActivePath('/docs/quickstart', '/docs') → true
 * @example isActivePath('/docs', '/docs') → true
 * @example isActivePath('/pricing', '/docs') → false
 */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

/** Overrides for a single breadcrumb segment. */
export interface SegmentOverride {
  label: string;
  href?: string;
}

/** A single breadcrumb trail item (pure — no React). */
export interface BreadcrumbTrailItem {
  /** Link target for this segment (or the last segment, if it were clickable). */
  href: string;
  /** Human-readable label to render. */
  label: string;
  /** True for the final segment, which is rendered as plain text. */
  isLast: boolean;
}

/** Default human-readable labels for known path segments. */
export const BREADCRUMB_LABELS: Record<string, string> = {
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

/**
 * Derive a breadcrumb trail from a pathname, applying label/href overrides.
 *
 * Returns an empty array when the path has no navigable trail (zero or one
 * segment), matching the Breadcrumbs component's "render nothing" behavior.
 */
export function buildBreadcrumbTrail(
  pathname: string,
  overrides: Record<string, SegmentOverride> = {},
): BreadcrumbTrailItem[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length <= 1) return [];

  return segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    const href = '/' + segments.slice(0, index + 1).join('/');
    const override = overrides[segment];
    const label = override?.label || BREADCRUMB_LABELS[segment] || segment;
    const linkHref = override?.href || href;
    return { href: linkHref, label, isLast };
  });
}

/** A single marketing navigation link. */
export interface MarketingNavItem {
  href: string;
  label: string;
  /** Short supporting line shown under the label in the "More" dropdown. */
  body?: string;
}

/** Primary marketing nav links (always visible on desktop). */
export const PRIMARY_NAV_ITEMS: MarketingNavItem[] = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/company', label: 'Company' },
];

/** Secondary marketing nav links surfaced in the "More" dropdown. */
export const MORE_NAV_ITEMS: MarketingNavItem[] = [
  { href: '/compare', label: 'Compare', body: 'vs corporate + shared cards' },
  { href: '/security', label: 'Security', body: 'Architecture + disclosure' },
  { href: '/careers', label: 'Careers', body: 'Open roles + benefits' },
  { href: '/press', label: 'Press', body: 'Media kit + contact' },
  { href: '/affiliate', label: 'Affiliate', body: 'Earn on every card · soon' },
];