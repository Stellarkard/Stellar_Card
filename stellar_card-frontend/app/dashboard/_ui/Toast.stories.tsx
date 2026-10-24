import type { Meta, StoryObj } from '@storybook/react-vite';
import { Toast } from './Toast';

const meta: Meta<typeof Toast> = {
  title: 'Dashboard/Notification/Toast',
  component: Toast,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Toast>;

export const Default: Story = {
  args: {
    title: 'Success',
    description: 'Operation completed successfully',
    type: 'success',
  },
};

export const Error: Story = {
  args: {
    title: 'Error',
    description: 'Something went wrong',
    type: 'error',
  },
};

export const Warning: Story = {
  args: {
    title: 'Warning',
    description: 'Pay attention to this',
    type: 'warning',
  },
};