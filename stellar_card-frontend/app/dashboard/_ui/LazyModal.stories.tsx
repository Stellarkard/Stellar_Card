import type { Meta, StoryObj } from '@storybook/react-vite';
import { LazyModal } from './LazyModal';

const meta: Meta<typeof LazyModal> = {
  title: 'Dashboard/Modal/LazyModal',
  component: LazyModal,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof LazyModal>;

export const Default: Story = {
  args: {
    open: false,
    onClose: () => {},
    children: 'Modal content',
  },
};

export const Open: Story = {
  args: {
    open: true,
    onClose: () => {},
    children: 'Modal content',
  },
};