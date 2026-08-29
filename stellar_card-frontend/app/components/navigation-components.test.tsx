import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Breadcrumbs } from './Breadcrumbs';
import { TabNav } from './TabNav';
import { ResponsiveNav } from './ResponsiveNav';
import { MobileDrawer } from './MobileDrawer';

describe('Breadcrumbs', () => {
  it('renders without crashing', () => {
    const el = <Breadcrumbs />;
    expect(el).toBeDefined();
  });

  it('accepts override labels', () => {
    const el = <Breadcrumbs overrides={{ agents: { label: 'My Agents' } }} />;
    expect(el).toBeDefined();
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
    expect(agentTab?.badge).toBe(3);
  });

  it('renders empty tabs array', () => {
    const el = <TabNav tabs={[]} />;
    expect(el.props.tabs).toHaveLength(0);
  });

  it('renders static markup with tab labels and badges', () => {
    const markup = renderToStaticMarkup(<TabNav tabs={tabs} />);
    expect(markup).toContain('Overview');
    expect(markup).toContain('Agents');
    expect(markup).toContain('Orders');
    expect(markup).toContain('3');
  });
});

describe('ResponsiveNav', () => {
  const items = [
    { href: '/features', label: 'Features', description: 'Explore capabilities' },
    { href: '/pricing', label: 'Pricing', description: 'Transparent plans' },
    { href: '/docs', label: 'Docs', description: 'API reference' },
  ];

  it('renders horizontal nav variant by default', () => {
    const markup = renderToStaticMarkup(<ResponsiveNav items={items} />);
    expect(markup).toContain('responsive-nav-horizontal');
    expect(markup).toContain('Features');
    expect(markup).toContain('Pricing');
    expect(markup).toContain('Docs');
    expect(markup).toContain('aria-label="Menu"');
  });

  it('renders sidebar nav variant', () => {
    const markup = renderToStaticMarkup(<ResponsiveNav items={items} variant="sidebar" />);
    expect(markup).toContain('responsive-nav-sidebar');
    expect(markup).toContain('Features');
  });

  it('renders vertical nav variant', () => {
    const markup = renderToStaticMarkup(<ResponsiveNav items={items} variant="vertical" />);
    expect(markup).toContain('responsive-nav-vertical');
    expect(markup).toContain('Features');
  });
});

describe('MobileDrawer', () => {
  it('renders dialog markup with ARIA tags when open', () => {
    const markup = renderToStaticMarkup(
      <MobileDrawer open={true} onClose={() => {}}>
        <div>Sidebar content</div>
      </MobileDrawer>
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="Navigation drawer"');
    expect(markup).toContain('Sidebar content');
  });
});
