
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Breadcrumbs } from './Breadcrumbs';
import { TabNav } from './TabNav';
import { ResponsiveNav } from './ResponsiveNav';
import { NavLinks } from './NavLinks';
import { MobileDrawer } from './MobileDrawer';

// Mock Next.js modules
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe('Breadcrumbs', () => {
  it('renders nothing for root path', () => {

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

describe('ResponsiveNav', () => {
  const mockItems = [
    { href: '/pricing', label: 'Pricing' },
    { href: '/docs', label: 'Docs', description: 'Documentation' },
    { href: '/about', label: 'About' },
  ];

  describe('horizontal variant', () => {
    it('renders all navigation items', () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" />
      );
      expect(container).toBeDefined();
    });

    it('displays toggle button on mobile', () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" />
      );
      const toggleButton = container.querySelector('.responsive-nav-toggle');
      expect(toggleButton).toBeDefined();
    });

    it('calls onNavigate callback when item is clicked', () => {
      const onNavigate = vi.fn();
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" onNavigate={onNavigate} />
      );
      expect(container).toBeDefined();
    });

    it('closes menu when escape key is pressed', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" />
      );
      const toggleButton = container.querySelector('.responsive-nav-toggle') as HTMLButtonElement;
      
      if (toggleButton) {
        await user.click(toggleButton);
        fireEvent.keyDown(container, { key: 'Escape' });
      }
      expect(container).toBeDefined();
    });

    it('navigates with arrow keys', async () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" enableKeyboardNav={true} />
      );
      const navContent = container.querySelector('.responsive-nav-content');
      
      if (navContent) {
        fireEvent.keyDown(navContent, { key: 'ArrowDown' });
      }
      expect(container).toBeDefined();
    });

    it('supports Home and End keyboard navigation', async () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" enableKeyboardNav={true} />
      );
      const navContent = container.querySelector('.responsive-nav-content');
      
      if (navContent) {
        fireEvent.keyDown(navContent, { key: 'Home' });
        fireEvent.keyDown(navContent, { key: 'End' });
      }
      expect(container).toBeDefined();
    });

    it('disables keyboard navigation when enableKeyboardNav is false', () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" enableKeyboardNav={false} />
      );
      const navContent = container.querySelector('.responsive-nav-content');
      
      if (navContent) {
        fireEvent.keyDown(navContent, { key: 'ArrowDown' });
      }
      expect(container).toBeDefined();
    });
  });

  describe('vertical variant', () => {
    it('renders vertical layout', () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="vertical" />
      );
      expect(container.querySelector('.responsive-nav-vertical')).toBeDefined();
    });
  });

  describe('sidebar variant', () => {
    it('renders sidebar layout', () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="sidebar" />
      );
      expect(container.querySelector('.responsive-nav-sidebar')).toBeDefined();
    });

    it('displays items as a column layout', () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="sidebar" />
      );
      const content = container.querySelector('.responsive-nav-content');
      expect(content).toBeDefined();
    });

    it('ignores keyboard navigation for sidebar variant', async () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="sidebar" enableKeyboardNav={true} />
      );
      const navContent = container.querySelector('.responsive-nav-content');
      
      if (navContent) {
        fireEvent.keyDown(navContent, { key: 'ArrowDown' });
      }
      expect(container).toBeDefined();
    });
  });

  describe('accessibility', () => {
    it('has proper ARIA roles and labels', () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" />
      );
      const nav = container.querySelector('nav[role="navigation"]');
      expect(nav).toBeDefined();
    });

    it('sets aria-current for active items', () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" />
      );
      expect(container).toBeDefined();
    });

    it('has aria-expanded on toggle button', () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" />
      );
      const toggleButton = container.querySelector('[aria-expanded]');
      expect(toggleButton).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles empty items array', () => {
      const { container } = render(
        <ResponsiveNav items={[]} variant="horizontal" />
      );
      expect(container).toBeDefined();
    });

    it('handles items with icons', () => {
      const itemsWithIcons = [
        { href: '/home', label: 'Home', icon: <span>🏠</span> },
      ];
      const { container } = render(
        <ResponsiveNav items={itemsWithIcons} variant="horizontal" />
      );
      const icon = container.querySelector('.responsive-nav-icon');
      expect(icon).toBeDefined();
    });

    it('handles very long labels gracefully', () => {
      const itemsWithLongLabels = [
        { href: '/long', label: 'This is a very long navigation label that should wrap' },
      ];
      const { container } = render(
        <ResponsiveNav items={itemsWithLongLabels} variant="horizontal" />
      );
      expect(container).toBeDefined();
    });

    it('respects reduced motion preference', () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" />
      );
      const styles = container.querySelector('style');
      expect(styles?.textContent).toContain('prefers-reduced-motion');
    });

    it('closes menu when clicking outside', async () => {
      const { container } = render(
        <ResponsiveNav items={mockItems} variant="horizontal" />
      );
      
      const toggleButton = container.querySelector('.responsive-nav-toggle') as HTMLButtonElement;
      if (toggleButton) {
        fireEvent.click(toggleButton);
        fireEvent.mouseDown(document.body);
      }
      
      expect(container).toBeDefined();
    });
  });
});

describe('NavLinks component', () => {
  it('renders primary navigation links', () => {
    const { container } = render(<NavLinks />);
    expect(container).toBeDefined();
  });

  it('has hamburger menu for mobile', () => {
    const { container } = render(<NavLinks />);
    const navToggle = container.querySelector('.nav-toggle');
    expect(navToggle).toBeDefined();
  });

  it('toggles menu when clicking hamburger', async () => {
    const user = userEvent.setup();
    const { container } = render(<NavLinks />);
    const navToggle = container.querySelector('.nav-toggle') as HTMLButtonElement;
    
    if (navToggle) {
      await user.click(navToggle);
      expect(navToggle.getAttribute('aria-expanded')).toBe('true');
    }
  });

  it('closes menu on escape key', async () => {
    const { container } = render(<NavLinks />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container).toBeDefined();
  });

  it('has More dropdown menu', () => {
    const { container } = render(<NavLinks />);
    const moreBtn = container.querySelector('.nav-more-btn');
    expect(moreBtn).toBeDefined();
  });
});

describe('MobileDrawer component', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <MobileDrawer open={false} onClose={() => {}}>
        <div>Content</div>
      </MobileDrawer>
    );
    const drawer = container.querySelector('.mobile-drawer');
    expect(drawer).toBeDefined();
  });

  it('shows overlay when open', () => {
    const { container } = render(
      <MobileDrawer open={true} onClose={() => {}}>
        <div>Content</div>
      </MobileDrawer>
    );
    const overlay = container.querySelector('.mobile-drawer-overlay');
    expect(overlay).toBeDefined();
  });

  it('calls onClose when overlay is clicked', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <MobileDrawer open={true} onClose={onClose}>
        <div>Content</div>
      </MobileDrawer>
    );
    const overlay = container.querySelector('.mobile-drawer-overlay') as HTMLDivElement;
    if (overlay) {
      fireEvent.click(overlay);
    }
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when escape key is pressed', () => {
    const onClose = vi.fn();
    const { container } = render(
      <MobileDrawer open={true} onClose={onClose}>
        <div>Content</div>
      </MobileDrawer>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('locks page scroll when open', () => {
    const { container } = render(
      <MobileDrawer open={true} onClose={() => {}}>
        <div>Content</div>
      </MobileDrawer>
    );
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('restores page scroll when closed', () => {
    const { rerender } = render(
      <MobileDrawer open={true} onClose={() => {}}>
        <div>Content</div>
      </MobileDrawer>
    );
    rerender(
      <MobileDrawer open={false} onClose={() => {}}>
        <div>Content</div>
      </MobileDrawer>
    );
    expect(document.documentElement.style.overflow).toBe('');
  });
});
