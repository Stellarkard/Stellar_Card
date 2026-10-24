import type { Meta, StoryObj } from '@storybook/react-vite';
import { SpendChart } from './SpendChart';

const meta: Meta<typeof SpendChart> = {
  title: 'Dashboard/Visualization/SpendChart',
  component: SpendChart,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof SpendChart>;

export const Default: Story = {
  args: {
    data: [
      { agent: 'Agent A', amount: 5000000 },
      { agent: 'Agent B', amount: 3000000 },
    ],
  },
};