import type { Meta, StoryObj } from '@storybook/react-vite';
import { LazyHorizontalBar } from './LazyHorizontalBar';

const meta: Meta<typeof LazyHorizontalBar> = {
  title: 'Dashboard/Visualization/LazyHorizontalBar',
  component: LazyHorizontalBar,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof LazyHorizontalBar>;

export const Default: Story = {
  args: {
    data: [
      { label: 'A', value: 40 },
      { label: 'B', value: 30 },
      { label: 'C', value: 20 },
      { label: 'D', value: 10 },
    ],
  },
};

export const WithRange: Story = {
  args: {
    data: [
      { label: 'A', value: 50 },
      { label: 'B', value: 30 },
    ],
    min: 0,
    max: 100,
  },
};