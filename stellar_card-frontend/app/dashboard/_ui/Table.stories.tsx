import type { Meta, StoryObj } from '@storybook/react';
import { Table } from './Table';
import { OrderStatusPill } from './OrderStatusPill';

const meta = {
  title: 'Dashboard/Table',
  component: Table,
  parameters: {
    docs: {
      description: {
        component: 'High-performance virtualized table for large datasets. Automatically virtualizes when data exceeds 50 rows.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

// Mock order data
const generateOrders = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `ord_${i.toString().padStart(8, '0')}`,
    agent: `Agent ${i % 10}`,
    amount: Math.floor(Math.random() * 100000),
    asset: i % 2 === 0 ? 'USDC' : 'XLM',
    status: ['delivered', 'pending_payment', 'failed', 'processing'][i % 4],
    created_at: Date.now() - i * 3600000,
  }));

const columns = [
  {
    id: 'id',
    header: 'Order ID',
    accessor: (row: any) => (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
        {row.id.slice(0, 12)}
      </span>
    ),
    width: 140,
  },
  {
    id: 'agent',
    header: 'Agent',
    accessor: (row: any) => row.agent,
  },
  {
    id: 'amount',
    header: 'Amount',
    accessor: (row: any) => (
      <span style={{ fontFamily: 'var(--font-mono)' }}>
        ${(row.amount / 10000).toFixed(2)}
      </span>
    ),
    align: 'right' as const,
    width: 100,
  },
  {
    id: 'asset',
    header: 'Asset',
    accessor: (row: any) => (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{row.asset}</span>
    ),
    width: 80,
  },
  {
    id: 'status',
    header: 'Status',
    accessor: (row: any) => <OrderStatusPill status={row.status} />,
    width: 120,
  },
];

export const Small: Story = {
  args: {
    data: generateOrders(10),
    columns,
    keyExtractor: (row: any) => row.id,
    onRowClick: (row: any) => console.log('Clicked:', row),
  },
};

export const Medium: Story = {
  args: {
    data: generateOrders(50),
    columns,
    keyExtractor: (row: any) => row.id,
    virtualized: false,
  },
};

export const Large: Story = {
  args: {
    data: generateOrders(200),
    columns,
    keyExtractor: (row: any) => row.id,
    virtualized: true,
    maxHeight: 500,
  },
  parameters: {
    docs: {
      description: {
        story: 'Virtualized table with 200 rows. Only visible rows are rendered for optimal performance.',
      },
    },
  },
};

export const VeryLarge: Story = {
  args: {
    data: generateOrders(1000),
    columns,
    keyExtractor: (row: any) => row.id,
    virtualized: true,
  },
  parameters: {
    docs: {
      description: {
        story: '1000 rows rendered efficiently with virtualization. Smooth scrolling maintained.',
      },
    },
  },
};

export const Empty: Story = {
  args: {
    data: [],
    columns,
    keyExtractor: (row: any) => row.id,
    emptyState: (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--fg-dim)' }}>
        No data available
      </div>
    ),
  },
};
