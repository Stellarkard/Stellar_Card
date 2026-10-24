import type { Meta, StoryObj } from '@storybook/react-vite';
import { Breadcrumbs } from './Breadcrumbs';

const meta: Meta<typeof Breadcrumbs> = {
  title: 'Components/Breadcrumbs',
  component: Breadcrumbs,
  tags: ['autodocs'],
  parameters: {
    backgrounds: {
      default: 'dark',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Breadcrumbs>;

export const TwolevelPath: Story = {
  render: () => (
    <div style={{ padding: '1rem', background: 'var(--bg)' }}>
      <Breadcrumbs />
    </div>
  ),
  parameters: {
    nextjs: {
      navigation: {
        pathname: '/dashboard/overview',
      },
    },
  },
};

export const DeepPath: Story = {
  render: () => (
    <div style={{ padding: '1rem', background: 'var(--bg)' }}>
      <Breadcrumbs />
    </div>
  ),
  parameters: {
    nextjs: {
      navigation: {
        pathname: '/dashboard/agents/agent-123/settings',
      },
    },
  },
};

export const WithOverrides: Story = {
  render: () => (
    <div style={{ padding: '1rem', background: 'var(--bg)' }}>
      <Breadcrumbs
        overrides={{
          agents: { label: 'All Agents', href: '/dashboard/agents' },
          'agent-123': { label: 'Test Agent' },
        }}
      />
    </div>
  ),
  parameters: {
    nextjs: {
      navigation: {
        pathname: '/dashboard/agents/agent-123/settings',
      },
    },
  },
};
