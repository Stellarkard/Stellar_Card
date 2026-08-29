import type { Meta, StoryObj } from '@storybook/react-vite';
import { StateDisplay } from './StateDisplay';

const meta: Meta<typeof StateDisplay> = {
  title: 'Dashboard/State/StateDisplay',
  component: StateDisplay,
  tags: ['autodocs'],
  argTypes: {
    isLoading: { control: 'boolean' },
    isEmpty: { control: 'boolean' },
    isError: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof StateDisplay>;

export const Default: Story = {
  args: {
    children: <div style={{ padding: '2rem', textAlign: 'center' }}>Your content here</div>,
  },
};

export const Loading: Story = {
  args: {
    isLoading: true,
    loadingTitle: 'Loading your data…',
  },
};

export const Empty: Story = {
  args: {
    isEmpty: true,
    emptyTitle: 'No agents yet',
    emptyDescription: 'Create your first agent to start issuing virtual cards.',
  },
};

export const EmptyWithAction: Story = {
  args: {
    isEmpty: true,
    emptyTitle: 'No orders found',
    emptyDescription: 'You haven\'t placed any orders yet. Place an order to get started.',
  },
};

export const Error: Story = {
  args: {
    isError: true,
    errorTitle: 'Failed to load data',
    errorMessage: 'Something went wrong while fetching your information. Please try again.',
    onRetry: () => alert('Retrying…'),
  },
};

export const ErrorWithCode: Story = {
  args: {
    isError: true,
    errorTitle: 'Server error',
    errorMessage: 'An internal error occurred. Please contact support.',
    error: 'ERR_INTERNAL_SERVER',
  },
};

export const ContextUsageExample: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div>
        <h3 style={{ marginBottom: '1rem' }}>Loading State:</h3>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
          <StateDisplay isLoading={true} />
        </div>
      </div>

      <div>
        <h3 style={{ marginBottom: '1rem' }}>Empty State:</h3>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
          <StateDisplay
            isEmpty={true}
            emptyTitle="No agents"
            emptyDescription="Start by creating your first agent"
          />
        </div>
      </div>

      <div>
        <h3 style={{ marginBottom: '1rem' }}>Error State:</h3>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
          <StateDisplay
            isError={true}
            errorTitle="Load failed"
            errorMessage="Check your connection and try again"
          />
        </div>
      </div>

      <div>
        <h3 style={{ marginBottom: '1rem' }}>Success State (with content):</h3>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '1rem' }}>
          <StateDisplay>
            <div style={{ padding: '1rem', background: 'var(--surface)', borderRadius: 6 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Your Agents
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted)' }}>
                3 active agents • Last updated 2 minutes ago
              </div>
            </div>
          </StateDisplay>
        </div>
      </div>
    </div>
  ),
};
