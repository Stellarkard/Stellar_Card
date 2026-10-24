import type { Meta, StoryObj } from '@storybook/react-vite';
import { LazyQrCode } from './LazyQrCode';

const meta: Meta<typeof LazyQrCode> = {
  title: 'Dashboard/Visualization/LazyQrCode',
  component: LazyQrCode,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof LazyQrCode>;

export const Default: Story = {
  args: {
    value: 'STL-CARD-TEST12345',
    size: 256,
  },
};

export const Large: Story = {
  args: {
    value: 'STL-CARD-TEST123456789',
    size: 512,
  },
};