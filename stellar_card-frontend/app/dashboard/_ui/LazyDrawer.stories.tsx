import type { Meta, StoryObj } from '@storybook/react-vite';
import { LazyDrawer } from './LazyDrawer';

const meta: Meta<typeof LazyDrawer> = {
  title: 'Dashboard/Layout/LazyDrawer',
  component: LazyDrawer,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof LazyDrawer>;

export const Default: Story = {
  args: {
    open: false,
    onOpenChange: () => {},
    children: 'Drawer content',
  },
};

export const Open: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    children: 'Drawer content',
  },
};