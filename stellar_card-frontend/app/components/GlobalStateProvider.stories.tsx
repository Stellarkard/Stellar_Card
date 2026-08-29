import type { Meta, StoryObj } from '@storybook/react-vite';
import { GlobalStateProvider } from './GlobalStateProvider';
import type { AsyncStatus } from '../lib/useAsyncState';

const meta: Meta<typeof GlobalStateProvider> = {
  title: 'Components/GlobalStateProvider',
  component: GlobalStateProvider,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof GlobalStateProvider>;

export const Loading: Story = {
  args: {
    status: 'loading' as AsyncStatus,
    children: () => <div>This should not be visible</div>,
  },
};

export const Success: Story = {
  args: {
    status: 'success' as AsyncStatus,
    isEmpty: false,
    children: () => (
      <div style={{ padding: '2rem', color: 'var(--fg)' }}>
        <h2>Data loaded successfully!</h2>
        <p>This is the rendered content.</p>
      </div>
    ),
  },
};

export const Empty: Story = {
  args: {
    status: 'success' as AsyncStatus,
    isEmpty: true,
    emptyTitle: 'No data available',
    emptyDescription: 'Try adjusting your filters or create a new item.',
    children: () => <div>This should not be visible</div>,
  },
};

export const Error: Story = {
  args: {
    status: 'error' as AsyncStatus,
    error: new Error('Failed to load data from server'),
    onRetry: () => console.log('Retry clicked'),
    children: () => <div>This should not be visible</div>,
  },
};

export const ErrorWithoutRetry: Story = {
  args: {
    status: 'error' as AsyncStatus,
    error: new Error('Network error'),
    children: () => <div>This should not be visible</div>,
  },
};

export const WithCustomEmpty: Story = {
  args: {
    status: 'success' as AsyncStatus,
    isEmpty: true,
    emptyTitle: 'No agents found',
    emptyDescription: 'Create your first agent to get started',
    emptyAction: (
      <button
        style={{
          padding: '0.5rem 1rem',
          background: 'var(--green)',
          color: 'var(--bg)',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontWeight: 600,
          marginTop: '0.5rem',
        }}
      >
        Create Agent
      </button>
    ),
    children: () => <div>This should not be visible</div>,
  },
};
