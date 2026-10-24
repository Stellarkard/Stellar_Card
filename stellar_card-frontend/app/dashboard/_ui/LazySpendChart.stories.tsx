import type { Meta, StoryObj } from '@storybook/react-vite';
import { LazySpendChart } from './LazySpendChart';

const meta: Meta<typeof LazySpendChart> = {
  title: 'Dashboard/Visualization/LazySpendChart',
  component: LazySpendChart,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof LazySpendChart>;

export const Default: Story = {
  args: {
    data: [
      { agent: 'Agent A', amount: 5000000 },
      { agent: 'Agent B', amount: 3000000 },
      { agent: 'Agent C', amount: 2000000 },
    ],
  },
};

export const LargeDataset: Story = {
  args: {
    data: [
      { agent: 'Agent A', amount: 10000000 },
      { agent: 'Agent B', amount: 8000000 },
      { agent: 'Agent C', amount: 6000000 },
      { agent: 'Agent D', amount: 4000000 },
      { agent: 'Agent E', amount: 2000000 },
    ],
  },
};