import type { Meta, StoryObj } from '@storybook/react-vite';
import { PageHeader } from './PageHeader';
import { Button } from './Button';

const meta: Meta<typeof PageHeader> = {
  title: 'Dashboard/Layout/PageHeader',
  component: PageHeader,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof PageHeader>;

export const Default: Story = {
  args: {
    title: 'Dashboard',
  },
};

export const WithSubtitle: Story = {
  args: {
    title: 'Agents',
    subtitle: 'Manage your virtual card issuers',
  },
};

export const WithActions: Story = {
  args: {
    title: 'Orders',
    subtitle: 'View and track all orders',
    actions: (
      <Button variant="primary">
        New Order
      </Button>
    ),
  },
};

export const WithBreadcrumb: Story = {
  render: () => (
    <PageHeader
      breadcrumb={
        <nav aria-label="Breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <a href="#" style={{ color: 'var(--fg-dim)', textDecoration: 'none' }}>
            Dashboard
          </a>
          <span style={{ color: 'var(--fg-dim)' }}>/</span>
          <span style={{ color: 'var(--fg-dim)' }}>Agents</span>
          <span style={{ color: 'var(--fg-dim)' }}>/</span>
          <span style={{ color: 'var(--fg)' }}>Agent Details</span>
        </nav>
      }
      title="Agent 001"
      subtitle="View detailed information about this agent"
      actions={
        <Button variant="secondary" size="sm">
          Edit
        </Button>
      }
    />
  ),
};

export const Complex: Story = {
  render: () => (
    <PageHeader
      breadcrumb={
        <span style={{ color: 'var(--fg-dim)' }}>
          Dashboard {' / '} Settings
        </span>
      }
      title="Account Settings"
      subtitle="Manage your account preferences and configurations"
      actions={
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="secondary" size="sm">
            Cancel
          </Button>
          <Button variant="primary" size="sm">
            Save Changes
          </Button>
        </div>
      }
    />
  ),
};

export const LongTitle: Story = {
  args: {
    title: 'This is a very long title that might wrap on smaller screens',
    subtitle: 'A descriptive subtitle providing context for this page',
    actions: <Button variant="ghost" size="sm">Action</Button>,
  },
};
