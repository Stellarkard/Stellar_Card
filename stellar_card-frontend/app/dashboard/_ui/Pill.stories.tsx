import type { Meta, StoryObj } from '@storybook/react-vite';
import { Pill } from './Pill';

const meta: Meta<typeof Pill> = {
  title: 'Dashboard/Pill',
  component: Pill,
  tags: ['autodocs'],
  argTypes: {
    tone: {
      control: 'select',
      options: ['green', 'red', 'yellow', 'blue', 'purple', 'neutral'],
    },
    pulse: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Pill>;

export const Live: Story = {
  args: {
    tone: 'green',
    pulse: true,
    children: 'Live',
  },
};

export const Error: Story = {
  args: {
    tone: 'red',
    children: 'Failed',
  },
};

export const Warning: Story = {
  args: {
    tone: 'yellow',
    children: 'Pending',
  },
};

export const Info: Story = {
  args: {
    tone: 'blue',
    children: 'Processing',
  },
};

export const Neutral: Story = {
  args: {
    tone: 'neutral',
    children: 'Expired',
  },
};
