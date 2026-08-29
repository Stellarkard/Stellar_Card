import type { Meta, StoryObj } from '@storybook/react-vite';
import { Card } from './Card';
import { Button } from './Button';

const meta: Meta<typeof Card> = {
  title: 'Dashboard/Layout/Card',
  component: Card,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: {
    children: (
      <div style={{ textAlign: 'center', color: 'var(--fg-muted)', fontSize: '0.75rem' }}>
        Card content goes here
      </div>
    ),
  },
};

export const WithTitle: Story = {
  args: {
    title: 'Recent Activity',
    children: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)', fontSize: '0.7rem' }}>
          <div style={{ color: 'var(--fg)', fontWeight: 500 }}>Transaction 1</div>
          <div style={{ color: 'var(--fg-dim)', marginTop: '0.2rem' }}>Jun 29, 11:30 AM</div>
        </div>
        <div style={{ padding: '0.5rem', fontSize: '0.7rem' }}>
          <div style={{ color: 'var(--fg)', fontWeight: 500 }}>Transaction 2</div>
          <div style={{ color: 'var(--fg-dim)', marginTop: '0.2rem' }}>Jun 28, 3:45 PM</div>
        </div>
      </div>
    ),
  },
};

export const WithActions: Story = {
  args: {
    title: 'Wallet Balance',
    actions: (
      <Button variant="ghost" size="sm">
        Refresh
      </Button>
    ),
    children: (
      <div style={{ textAlign: 'center', padding: '1rem' }}>
        <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--green)' }}>$1,234.56</div>
        <div style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', marginTop: '0.5rem' }}>
          Available balance
        </div>
      </div>
    ),
  },
};

export const EdgeToEdge: Story = {
  args: {
    title: 'Agents',
    padding: 0,
    children: (
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.7rem',
        }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontWeight: 600, color: 'var(--fg-muted)' }}>
              Name
            </th>
            <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontWeight: 600, color: 'var(--fg-muted)' }}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '0.5rem 1rem', color: 'var(--fg)' }}>Agent 1</td>
            <td style={{ padding: '0.5rem 1rem', color: 'var(--green)' }}>Active</td>
          </tr>
          <tr>
            <td style={{ padding: '0.5rem 1rem', color: 'var(--fg)' }}>Agent 2</td>
            <td style={{ padding: '0.5rem 1rem', color: 'var(--fg-dim)' }}>Inactive</td>
          </tr>
        </tbody>
      </table>
    ),
  },
};

export const WithCustomPadding: Story = {
  args: {
    title: 'Custom Spacing',
    padding: '2rem',
    children: (
      <div style={{ color: 'var(--fg-muted)', fontSize: '0.75rem', lineHeight: 1.6 }}>
        This card has custom padding applied for different spacing needs.
      </div>
    ),
  },
};

export const Nested: Story = {
  render: () => (
    <Card title="Outer Card">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <Card title="Inner 1">
          <div style={{ color: 'var(--fg-muted)', fontSize: '0.7rem' }}>
            Nested card content
          </div>
        </Card>
        <Card title="Inner 2">
          <div style={{ color: 'var(--fg-muted)', fontSize: '0.7rem' }}>
            More nested content
          </div>
        </Card>
      </div>
    </Card>
  ),
};
