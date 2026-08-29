import type { Meta, StoryObj } from '@storybook/react-vite';
import { HorizontalBar } from './HorizontalBar';

const meta: Meta<typeof HorizontalBar> = {
  title: 'Dashboard/Charts/HorizontalBar',
  component: HorizontalBar,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof HorizontalBar>;

export const Default: Story = {
  args: {
    rows: [
      { label: 'Agent 1', value: 45000 },
      { label: 'Agent 2', value: 38000 },
      { label: 'Agent 3', value: 29000 },
      { label: 'Agent 4', value: 15000 },
    ],
  },
};

export const WithTrailing: Story = {
  args: {
    rows: [
      { label: 'January', value: 42000, trailing: '$42K' },
      { label: 'February', value: 35800, trailing: '$35.8K' },
      { label: 'March', value: 51200, trailing: '$51.2K' },
      { label: 'April', value: 47900, trailing: '$47.9K' },
    ],
  },
};

export const Percentages: Story = {
  args: {
    rows: [
      { label: 'Success', value: 87, trailing: '87%' },
      { label: 'Pending', value: 10, trailing: '10%' },
      { label: 'Failed', value: 3, trailing: '3%' },
    ],
    max: 100,
  },
};

export const Empty: Story = {
  args: {
    rows: [],
  },
};

export const CustomHeight: Story = {
  args: {
    rows: [
      { label: 'Desktop', value: 65000 },
      { label: 'Mobile', value: 32000 },
      { label: 'Tablet', value: 18000 },
    ],
    height: 20,
  },
};

export const SingleRow: Story = {
  args: {
    rows: [{ label: 'Total Orders', value: 1234, trailing: '1,234' }],
  },
};

export const LongLabels: Story = {
  args: {
    rows: [
      { label: 'Very Long Agent Name That Might Wrap', value: 45000 },
      { label: 'Another Long Label Here', value: 38000 },
      { label: 'Short', value: 29000 },
    ],
  },
};
