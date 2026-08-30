import type { Meta, StoryObj } from '@storybook/react-vite';
import { OrderStatusPill } from './OrderStatusPill';

const meta: Meta<typeof OrderStatusPill> = {
  title: 'Dashboard/OrderStatusPill',
  component: OrderStatusPill,
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: [
        'delivered',
        'failed',
        'refunded',
        'refund_pending',
        'pending_payment',
        'payment_confirmed',
        'ordering',
        'claim_received',
        'stage1_done',
        'rejected',
        'expired',
        'pending_manual_recovery',
      ],
    },
  },
};

export default meta;
type Story = StoryObj<typeof OrderStatusPill>;

export const Delivered: Story = {
  args: { status: 'delivered' },
};

export const Failed: Story = {
  args: { status: 'failed' },
};

export const Refunded: Story = {
  args: { status: 'refunded' },
};

export const RefundPending: Story = {
  args: { status: 'refund_pending' },
};

export const PendingPayment: Story = {
  args: { status: 'pending_payment' },
};

export const Ordering: Story = {
  args: { status: 'ordering' },
};

export const Rejected: Story = {
  args: { status: 'rejected' },
};

export const UnknownStatus: Story = {
  args: { status: 'custom_new_status' },
};
