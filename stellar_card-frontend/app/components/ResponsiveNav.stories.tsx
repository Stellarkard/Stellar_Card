import type { Meta, StoryObj } from '@storybook/react';
import { ResponsiveNav } from './ResponsiveNav';
import { useState } from 'react';

const meta = {
  title: 'Components/Navigation/ResponsiveNav',
  component: ResponsiveNav,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A flexible, responsive navigation component that supports horizontal, vertical, and sidebar layouts. Features keyboard navigation, accessibility support, and mobile-friendly interactions.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ResponsiveNav>;

export default meta;
type Story = StoryObj<typeof meta>;

// Example navigation items
const navigationItems = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs', label: 'Documentation', description: 'API reference and guides' },
  { href: '/changelog', label: 'Changelog', description: 'See what\'s new' },
  { href: '/company', label: 'Company', description: 'About us and team' },
];

const navigationItemsWithIcons = [
  {
    href: '/home',
    label: 'Home',
    icon: <span style={{ fontSize: '1rem' }}>🏠</span>,
  },
  {
    href: '/docs',
    label: 'Documentation',
    icon: <span style={{ fontSize: '1rem' }}>📚</span>,
    description: 'API reference and guides',
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: <span style={{ fontSize: '1rem' }}>⚙️</span>,
  },
  {
    href: '/help',
    label: 'Help',
    icon: <span style={{ fontSize: '1rem' }}>❓</span>,
    description: 'Get support',
  },
];

/**
 * Default horizontal navigation. On mobile (< 768px), the menu collapses into a hamburger button.
 * Use arrow keys to navigate, Enter to select, and Escape to close on mobile.
 */
export const HorizontalDefault: Story = {
  args: {
    items: navigationItems,
    variant: 'horizontal',
  },
  render: (args) => (
    <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
      <ResponsiveNav {...args} />
    </div>
  ),
};

/**
 * Horizontal navigation with icon and description support.
 * Each item can include an icon and optional description text.
 */
export const HorizontalWithIcons: Story = {
  args: {
    items: navigationItemsWithIcons,
    variant: 'horizontal',
  },
  render: (args) => (
    <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
      <ResponsiveNav {...args} />
    </div>
  ),
};

/**
 * Vertical navigation layout, useful for dashboards or secondary menus.
 * Items stack vertically and are responsive to screen size.
 */
export const VerticalLayout: Story = {
  args: {
    items: navigationItems,
    variant: 'vertical',
  },
  render: (args) => (
    <div style={{ maxWidth: '400px', borderRight: '1px solid var(--border)' }}>
      <ResponsiveNav {...args} />
    </div>
  ),
};

/**
 * Sidebar navigation layout, optimized for main application navigation.
 * On desktop, it becomes a sticky sidebar; on mobile, it's part of the responsive flow.
 */
export const SidebarLayout: Story = {
  args: {
    items: navigationItemsWithIcons,
    variant: 'sidebar',
  },
  render: (args) => (
    <div style={{ display: 'flex', height: '400px', borderRight: '1px solid var(--border)' }}>
      <ResponsiveNav {...args} />
      <div style={{ flex: 1, padding: '1rem', overflow: 'auto' }}>
        <h2>Content Area</h2>
        <p>Sidebar navigation example. Try resizing to see responsive behavior.</p>
      </div>
    </div>
  ),
};

/**
 * Navigation with custom className for additional styling.
 */
export const WithCustomClass: Story = {
  args: {
    items: navigationItems,
    variant: 'horizontal',
    className: 'custom-nav',
  },
  render: (args) => (
    <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
      <ResponsiveNav {...args} />
    </div>
  ),
};

/**
 * Interactive example demonstrating the onNavigate callback.
 * Click any navigation item to see the callback in action.
 */
export const InteractiveNavigation: Story = {
  args: {
    items: navigationItems,
    variant: 'horizontal',
  },
  render: (args) => {
    const [lastNavigation, setLastNavigation] = useState<string | null>(null);

    return (
      <div>
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
          <ResponsiveNav
            {...args}
            onNavigate={(href) => {
              setLastNavigation(href);
            }}
          />
        </div>
        {lastNavigation && (
          <div
            style={{
              padding: '1rem',
              background: 'var(--green-muted)',
              color: 'var(--green)',
              margin: '1rem',
              borderRadius: '8px',
            }}
          >
            Last navigation: <strong>{lastNavigation}</strong>
          </div>
        )}
      </div>
    );
  },
};

/**
 * Example with disabled keyboard navigation.
 * Useful when keyboard events are handled elsewhere in the application.
 */
export const DisabledKeyboardNav: Story = {
  args: {
    items: navigationItems,
    variant: 'horizontal',
    enableKeyboardNav: false,
  },
  render: (args) => (
    <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
      <ResponsiveNav {...args} />
      <p style={{ fontSize: '0.85rem', color: 'var(--fg-muted)', marginTop: '1rem' }}>
        Keyboard navigation is disabled for this example.
      </p>
    </div>
  ),
};

/**
 * Long navigation menu demonstrating how items are handled.
 * The component properly wraps and scrolls on smaller viewports.
 */
export const LongNavigation: Story = {
  args: {
    items: [
      { href: '/home', label: 'Home' },
      { href: '/features', label: 'Features', description: 'What we offer' },
      { href: '/pricing', label: 'Pricing', description: 'Plans and billing' },
      { href: '/docs', label: 'Documentation', description: 'API and guides' },
      { href: '/blog', label: 'Blog', description: 'Articles and updates' },
      { href: '/changelog', label: 'Changelog', description: 'Release notes' },
      { href: '/company', label: 'Company', description: 'About us' },
      { href: '/careers', label: 'Careers', description: 'Join our team' },
      { href: '/contact', label: 'Contact', description: 'Get in touch' },
    ],
    variant: 'horizontal',
  },
  render: (args) => (
    <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
      <ResponsiveNav {...args} />
    </div>
  ),
};

/**
 * Empty navigation state.
 * The component handles empty item arrays gracefully.
 */
export const EmptyNavigation: Story = {
  args: {
    items: [],
    variant: 'horizontal',
  },
  render: (args) => (
    <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
      <ResponsiveNav {...args} />
      <p style={{ fontSize: '0.85rem', color: 'var(--fg-muted)', marginTop: '1rem' }}>
        Empty navigation items array - component renders gracefully.
      </p>
    </div>
  ),
};

/**
 * Accessibility features showcase.
 * This example highlights keyboard navigation with arrow keys.
 * - Use arrow keys (↑↓ or ←→) to navigate between items
 * - Use Home/End keys to jump to first/last item
 * - Use Enter to select an item
 * - Use Escape to close the mobile menu
 */
export const AccessibilityFeatures: Story = {
  args: {
    items: navigationItems,
    variant: 'horizontal',
    enableKeyboardNav: true,
  },
  render: (args) => (
    <div>
      <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
        <ResponsiveNav {...args} />
      </div>
      <div style={{ padding: '1rem', background: 'var(--blue-muted)', borderRadius: '8px', margin: '1rem' }}>
        <h3 style={{ color: 'var(--blue)', marginTop: 0 }}>Keyboard Navigation</h3>
        <ul style={{ marginBottom: 0 }}>
          <li><strong>Arrow Keys (↑↓ or ←→)</strong>: Navigate between items</li>
          <li><strong>Home</strong>: Jump to first item</li>
          <li><strong>End</strong>: Jump to last item</li>
          <li><strong>Enter</strong>: Activate current item</li>
          <li><strong>Escape</strong>: Close mobile menu</li>
        </ul>
      </div>
    </div>
  ),
};

/**
 * Responsive behavior example.
 * Resize your browser to see how the navigation adapts from desktop to mobile.
 * At smaller viewports, items move to a hamburger menu.
 */
export const ResponsiveBehavior: Story = {
  args: {
    items: navigationItems,
    variant: 'horizontal',
  },
  parameters: {
    viewport: {
      defaultViewport: 'iphone12',
    },
  },
  render: (args) => (
    <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', maxWidth: '100%' }}>
      <ResponsiveNav {...args} />
      <p style={{ fontSize: '0.85rem', color: 'var(--fg-muted)', marginTop: '1rem' }}>
        Try resizing the viewport or selecting different device sizes in Storybook.
      </p>
    </div>
  ),
};

/**
 * Mixed content navigation with various item configurations.
 * Demonstrates icons, descriptions, and styling variations.
 */
export const MixedContent: Story = {
  args: {
    items: [
      {
        href: '/',
        label: 'Home',
        icon: <span>🏠</span>,
      },
      {
        href: '/products',
        label: 'Products',
        icon: <span>📦</span>,
        description: 'Browse our catalog',
      },
      {
        href: '/support',
        label: 'Support',
        icon: <span>🆘</span>,
      },
    ],
    variant: 'sidebar',
  },
  render: (args) => (
    <div style={{ maxWidth: '300px', borderRight: '1px solid var(--border)' }}>
      <ResponsiveNav {...args} />
    </div>
  ),
};
