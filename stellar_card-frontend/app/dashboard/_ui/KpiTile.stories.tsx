import type { Meta, StoryObj } from '@storybook/react-vite';
import { KpiTile } from './KpiTile';

const meta: Meta<typeof KpiTile> = {
  title: 'Dashboard/Metrics/KpiTile',
  component: KpiTile,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof KpiTile>;

export const Default: Story = {
  args: {
    label: 'Total Volume',
    value: '$1,234,567.89',
  },
};

export const WithDeltaPositive: Story = {
  args: {
    label: 'Monthly Revenue',
    value: '$45,678.90',
    delta: {
      value: '+12.5%',
      positive: true,
    },
  },
};

export const WithDeltaNegative: Story = {
  args: {
    label: 'Active Users',
    value: '3,421',
    delta: {
      value: '-2.3%',
      positive: false,
    },
  },
};

export const WithHint: Story = {
  args: {
    label: 'Available Balance',
    value: '$98,765.43',
    hint: 'Last updated 2 minutes ago',
  },
};

export const AllFeatures: Story = {
  args: {
    label: 'Total Transactions',
    value: '12,847',
    delta: {
      value: '+5.2%',
      positive: true,
    },
    hint: 'Compared to last month',
  },
};

export const Grid: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
      <KpiTile label="Total Cards" value="127" delta={{ value: '+8', positive: true }} />
      <KpiTile label="Active Users" value="3,421" delta={{ value: '-5.2%', positive: false }} />
      <KpiTile label="Monthly Spend" value="$234,567.89" />
      <KpiTile
        label="Conversion"
        value="3.2%"
        delta={{ value: '+0.5%', positive: true }}
        hint="30-day average"
      />
    </div>
  ),
};

export const Narrow: Story = {
  args: {
    label: 'Min Sp Lim',
    value: '$1.5M',
  },
  render: (args) => (
    <div style={{ maxWidth: 120 }}>
      <KpiTile {...args} />
    </div>
  ),
};
