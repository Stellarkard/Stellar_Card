import type { Meta, StoryObj } from '@storybook/react';
import { WalletConnectionStatus } from './WalletConnectionStatus';

const meta: Meta<typeof WalletConnectionStatus> = {
  title: 'Dashboard/WalletConnectionStatus',
  component: WalletConnectionStatus,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof WalletConnectionStatus>;

export const Disconnected: Story = {
  args: {
    state: 'disconnected',
    onConnect: () => console.log('Connect clicked'),
  },
};

export const Connecting: Story = {
  args: {
    state: 'connecting',
  },
};

export const Connected: Story = {
  args: {
    state: 'connected',
    publicKey: 'GABC123XYZ456DEF789GHI012JKL345MNO678PQR',
    network: 'mainnet',
    onDisconnect: () => console.log('Disconnect clicked'),
  },
};

export const ConnectedTestnet: Story = {
  args: {
    state: 'connected',
    publicKey: 'GTEST123TEST456TEST789TEST012TEST345TEST678',
    network: 'testnet',
    onDisconnect: () => console.log('Disconnect clicked'),
  },
};

export const Error: Story = {
  args: {
    state: 'error',
    onRetry: () => console.log('Retry clicked'),
  },
};

export const NetworkMismatch: Story = {
  args: {
    state: 'network_mismatch',
    onRetry: () => console.log('Retry clicked'),
  },
};

export const InsufficientBalance: Story = {
  args: {
    state: 'insufficient_balance',
  },
};

export const Compact: Story = {
  args: {
    state: 'connected',
    network: 'mainnet',
    compact: true,
  },
};

export const CompactDisconnected: Story = {
  args: {
    state: 'disconnected',
    compact: true,
  },
};
