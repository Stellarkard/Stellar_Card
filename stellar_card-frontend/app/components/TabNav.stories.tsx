import type { Meta, StoryObj } from '@storybook/react-vite';
import { TabNav } from './TabNav';

const meta: Meta<typeof TabNav> = {
  title: 'Components/TabNav',
  component: TabNav,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof TabNav>;

const baseTabs = [
  { href: '/dashboard/overview', label: 'Overview' },
  { href: '/dashboard/overview/analytics', label: 'Analytics' },
  { href: '/dashboard/overview/reports', label: 'Reports' },
];

const tabsWithBadges = [
  { href: '/dashboard/overview', label: 'Overview', badge: 0 },
  { href: '/dashboard/overview/approvals', label: 'Approvals', badge: 5 },
  { href: '/dashboard/overview/alerts', label: 'Alerts', badge: 12 },
  { href: '/dashboard/overview/audit', label: 'Audit log', badge: 0 },
];

const manyTabs = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/agents', label: 'Agents' },
  { href: '/dashboard/orders', label: 'Orders' },
  { href: '/dashboard/approvals', label: 'Approvals' },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/dashboard/merchants', label: 'Merchants' },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export const Default: Story = {
  args: {
    tabs: baseTabs,
  },
};

export const WithBadges: Story = {
  args: {
    tabs: tabsWithBadges,
  },
};

export const ManyTabs: Story = {
  render: (args) => (
    <div style={{ width: '100%', maxWidth: '800px' }}>
      <TabNav {...args} />
    </div>
  ),
  args: {
    tabs: manyTabs,
  },
};

export const Compact: Story = {
  args: {
    tabs: [
      { href: '/settings/profile', label: 'Profile' },
      { href: '/settings/security', label: 'Security' },
      { href: '/settings/notifications', label: 'Notifications' },
    ],
  },
};
