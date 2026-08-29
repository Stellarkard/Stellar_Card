// Unit tests for dashboard shared UI components — prop validation via
// renderToStaticMarkup (SSR string output) and JSX prop assertions.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Pill } from './Pill';
import { FilterChip } from './FilterChip';
import { KpiTile, KpiRow } from './KpiTile';
import { PageHeader } from './PageHeader';
import { Card } from './Card';

describe('Pill', () => {
  it('renders with default neutral tone', () => {
    const el = createElement(Pill, { children: 'Active' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Active');
  });

  it('renders with green tone', () => {
    const el = createElement(Pill, { tone: 'green', children: 'Connected' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--green)');
    expect(markup).toContain('Connected');
  });

  it('renders with red tone', () => {
    const el = createElement(Pill, { tone: 'red', children: 'Failed' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--red)');
    expect(markup).toContain('Failed');
  });

  it('renders with yellow tone', () => {
    const el = createElement(Pill, { tone: 'yellow', children: 'Pending' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--yellow)');
    expect(markup).toContain('Pending');
  });

  it('renders with blue tone', () => {
    const el = createElement(Pill, { tone: 'blue', children: 'Processing' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--blue)');
    expect(markup).toContain('Processing');
  });

  it('renders with purple tone', () => {
    const el = createElement(Pill, { tone: 'purple', children: 'Ordering' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--purple)');
    expect(markup).toContain('Ordering');
  });

  it('includes pulse animation when pulse is true', () => {
    const el = createElement(Pill, { tone: 'green', pulse: true, children: 'Live' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('pulse');
  });

  it('sets aria-label from children when title is not provided', () => {
    const el = createElement(Pill, { children: 'Delivered' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('aria-label="Delivered"');
  });

  it('sets aria-label from title when title is provided', () => {
    const el = createElement(Pill, { title: 'Order Status', children: 'Delivered' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('aria-label="Order Status"');
  });

  it('renders mono font family', () => {
    const el = createElement(Pill, { children: 'Test' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--font-mono)');
  });
});

describe('FilterChip', () => {
  it('renders as a button element', () => {
    const el = createElement(FilterChip, {
      active: true,
      onClick: () => {},
      children: 'All',
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('<button');
    expect(markup).toContain('All');
  });

  it('applies active styling when active is true', () => {
    const el = createElement(FilterChip, {
      active: true,
      onClick: () => {},
      children: 'Active',
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--surface)');
    expect(markup).toContain('var(--border-strong)');
  });

  it('applies inactive styling when active is false', () => {
    const el = createElement(FilterChip, {
      active: false,
      onClick: () => {},
      children: 'Inactive',
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('transparent');
  });

  it('renders count when provided', () => {
    const el = createElement(FilterChip, {
      active: true,
      onClick: () => {},
      count: 5,
      children: 'Orders',
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('5');
  });

  it('does not render count when not provided', () => {
    const el = createElement(FilterChip, {
      active: true,
      onClick: () => {},
      children: 'Orders',
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).not.toContain('var(--font-mono)');
  });

  it('renders tone dot when tone is provided', () => {
    const el = createElement(FilterChip, {
      active: true,
      onClick: () => {},
      tone: 'green',
      children: 'Success',
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--green)');
  });

  it('does not render tone dot when tone is not provided', () => {
    const el = createElement(FilterChip, {
      active: true,
      onClick: () => {},
      children: 'All',
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).not.toContain('border-radius: 50%');
  });

  it('renders with pill shape border radius', () => {
    const el = createElement(FilterChip, {
      active: true,
      onClick: () => {},
      children: 'Test',
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toMatch(/border-radius:\s*999/);
  });
});

describe('KpiTile', () => {
  it('renders label and value', () => {
    const el = createElement(KpiTile, { label: 'Revenue', value: '$1,234' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('Revenue');
    expect(markup).toContain('$1,234');
  });

  it('renders with kpi-tile class', () => {
    const el = createElement(KpiTile, { label: 'Orders', value: 42 });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('class="kpi-tile"');
  });

  it('renders positive delta with green color', () => {
    const el = createElement(KpiTile, {
      label: 'Revenue',
      value: '$1,234',
      delta: { value: '+12%', positive: true },
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--green)');
    expect(markup).toContain('+12%');
  });

  it('renders negative delta with red color', () => {
    const el = createElement(KpiTile, {
      label: 'Revenue',
      value: '$1,234',
      delta: { value: '-5%', positive: false },
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--red)');
    expect(markup).toContain('-5%');
  });

  it('renders hint text', () => {
    const el = createElement(KpiTile, {
      label: 'Revenue',
      value: '$1,234',
      hint: 'vs last month',
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('vs last month');
  });

  it('renders without delta or hint', () => {
    const el = createElement(KpiTile, { label: 'Orders', value: 42 });
    const markup = renderToStaticMarkup(el);
    expect(markup).not.toContain('var(--green)');
    expect(markup).not.toContain('var(--red)');
  });

  it('renders mono font for label', () => {
    const el = createElement(KpiTile, { label: 'Revenue', value: '$1,234' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--font-mono)');
  });
});

describe('KpiRow', () => {
  it('renders children in a grid layout', () => {
    const el = createElement(KpiRow, null,
      createElement(KpiTile, { label: 'A', value: 1 }),
      createElement(KpiTile, { label: 'B', value: 2 }),
    );
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('grid');
    expect(markup).toContain('A');
    expect(markup).toContain('B');
  });
});

describe('PageHeader', () => {
  it('renders title', () => {
    const el = createElement(PageHeader, { title: 'Dashboard' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('Dashboard');
  });

  it('renders subtitle when provided', () => {
    const el = createElement(PageHeader, {
      title: 'Agents',
      subtitle: 'Manage your AI agents',
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('Agents');
    expect(markup).toContain('Manage your AI agents');
  });

  it('renders actions when provided', () => {
    const el = createElement(PageHeader, {
      title: 'Orders',
      actions: createElement('button', null, 'New Order'),
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('Orders');
    expect(markup).toContain('New Order');
  });

  it('renders breadcrumb when provided', () => {
    const el = createElement(PageHeader, {
      title: 'Settings',
      breadcrumb: createElement('span', null, 'Home > Dashboard > Settings'),
    });
    const markup = renderToStaticMarkup(el);
    // React HTML-encodes '>' as '&gt;' in static markup
    expect(markup).toContain('Home &gt; Dashboard &gt; Settings');
    expect(markup).toContain('Settings');
  });

  it('renders without optional props', () => {
    const el = createElement(PageHeader, { title: 'Overview' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('Overview');
  });
});

describe('Card', () => {
  it('renders children', () => {
    const el = createElement(Card, { children: createElement('p', null, 'Content') });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('Content');
  });

  it('renders with title', () => {
    const el = createElement(Card, { title: 'Recent Activity', children: 'Content' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('Recent Activity');
  });

  it('renders with actions', () => {
    const el = createElement(Card, {
      title: 'Orders',
      actions: createElement('button', null, 'View All'),
      children: 'Content',
    });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('View All');
  });

  it('applies dashboard-card class', () => {
    const el = createElement(Card, { children: 'Content' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('class="dashboard-card"');
  });

  it('applies dashboard-card-scroll class when padding is 0', () => {
    const el = createElement(Card, { padding: 0, children: 'Content' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('dashboard-card-scroll');
  });

  it('applies custom padding', () => {
    const el = createElement(Card, { padding: '2rem', children: 'Content' });
    const markup = renderToStaticMarkup(el);
    // React serializes inline styles without spaces after colons
    expect(markup).toMatch(/padding:\s*2rem/);
  });

  it('applies custom style', () => {
    const el = createElement(Card, { style: { marginTop: '1rem' }, children: 'Content' });
    const markup = renderToStaticMarkup(el);
    // React serializes inline styles without spaces after colons
    expect(markup).toMatch(/margin-top:\s*1rem/);
  });

  it('renders surface background and border', () => {
    const el = createElement(Card, { children: 'Content' });
    const markup = renderToStaticMarkup(el);
    expect(markup).toContain('var(--surface)');
    expect(markup).toContain('var(--border)');
  });
});
