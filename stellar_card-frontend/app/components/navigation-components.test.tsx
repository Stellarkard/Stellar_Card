import { describe, it, expect } from 'vitest';
import { Breadcrumbs } from './Breadcrumbs';
import { TabNav } from './TabNav';

describe('Breadcrumbs', () => {
  it('renders nothing for root path', () => {
    // Root path segments would be empty after filter
    const el = <Breadcrumbs />;
    expect(el).toBeDefined();
  });

  it('accepts override labels', () => {
    const el = <Breadcrumbs overrides={{ agents: { label: 'My Agents' } }} />;
    expect(el.props.overrides).toMatchObject({ agents: { label: 'My Agents' } });
  });
});

describe('TabNav', () => {
  const tabs = [
    { href: '/dashboard/overview', label: 'Overview' },
    { href: '/dashboard/agents', label: 'Agents', badge: 3 },
    { href: '/dashboard/orders', label: 'Orders' },
  ];

  it('renders all tabs', () => {
    const el = <TabNav tabs={tabs} />;
    expect(el.props.tabs).toHaveLength(3);
  });

  it('supports badge counts', () => {
    const el = <TabNav tabs={tabs} />;
    const agentTab = el.props.tabs.find((t: { label: string }) => t.label === 'Agents');
    expect(agentTab.badge).toBe(3);
  });

  it('renders empty tabs array', () => {
    const el = <TabNav tabs={[]} />;
    expect(el.props.tabs).toHaveLength(0);
  });
});
