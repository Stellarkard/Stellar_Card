import type { Meta, StoryObj } from '@storybook/react-vite';
import { Modal } from './Modal';
import { Button } from './Button';

const meta: Meta<typeof Modal> = {
  title: 'Dashboard/UI/Modal',
  component: Modal,
  tags: ['autodocs'],
  args: {
    open: true,
    title: 'Top Up Agent Wallet',
    description: 'Send USDC or XLM to your agent wallet address.',
    children: (
      <div>
        <p style={{ margin: '0 0 1rem', color: 'var(--fg-muted)', fontSize: '0.8rem' }}>
          Your transaction will settle within 3-5 seconds on Stellar testnet.
        </p>
        <input
          type="text"
          placeholder="Amount in USDC"
          style={{
            width: '100%',
            padding: '0.5rem',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--fg)',
          }}
        />
      </div>
    ),
    footer: (
      <>
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Send Deposit</Button>
      </>
    ),
  },
};

export default meta;
type Story = StoryObj<typeof Modal>;

export const Default: Story = {};

export const Small: Story = {
  args: {
    size: 'sm',
    title: 'Confirm Action',
    description: 'Are you sure you want to pause this agent key?',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
    title: 'API Key Details & Policies',
    description: 'Configure rate limits and auto-topup thresholds.',
  },
};

export const AlertDialog: Story = {
  args: {
    role: 'alertdialog',
    title: 'Revoke Key',
    description: 'This key will immediately lose access to fund disbursement.',
    footer: (
      <>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Revoke Key</Button>
      </>
    ),
  },
};
