// Mock Wallet Sandbox Context Integration Tests (Part 4)
// Tests for MockWalletProvider, custom scenario configurations, testing hooks, and dynamic transitions

import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { MockWalletProvider } from './MockWalletProvider';
import { useWalletConnection } from './useWalletConnection';
import { createMockWalletConnection, MOCK_WALLET_PUBLIC_KEYS, MOCK_WALLET_BALANCES } from './mockWallet';

function TestWalletConsumer() {
  const wallet = useWalletConnection();
  return (
    <div>
      <div data-testid="wallet-state">{wallet.state}</div>
      <div data-testid="wallet-pk">{wallet.publicKey ?? 'none'}</div>
      <div data-testid="wallet-network">{wallet.network ?? 'none'}</div>
      <div data-testid="wallet-connected">{wallet.isConnected ? 'yes' : 'no'}</div>
      <div data-testid="wallet-connecting">{wallet.isConnecting ? 'yes' : 'no'}</div>
      <div data-testid="wallet-error-flag">{wallet.isError ? 'yes' : 'no'}</div>
      <div data-testid="wallet-error-msg">{wallet.error ?? 'none'}</div>
      <div data-testid="wallet-label">{wallet.label}</div>
      <div data-testid="wallet-xlm">{wallet.balance?.xlm ?? 'none'}</div>
      <div data-testid="wallet-usdc">{wallet.balance?.usdc ?? 'none'}</div>
      <div data-testid="wallet-history-count">{wallet.history.length}</div>
      <button onClick={() => wallet.connect('GNEWKEY', 'testnet')}>Connect</button>
      <button onClick={() => wallet.disconnect()}>Disconnect</button>
      <button onClick={() => wallet.retry()}>Retry</button>
    </div>
  );
}

describe('MockWalletProvider Sandbox Context (Part 4)', () => {
  it('provides default disconnected scenario when no props given', () => {
    render(
      <MockWalletProvider>
        <TestWalletConsumer />
      </MockWalletProvider>
    );

    expect(screen.getByTestId('wallet-state').textContent).toBe('disconnected');
    expect(screen.getByTestId('wallet-connected').textContent).toBe('no');
    expect(screen.getByTestId('wallet-pk').textContent).toBe('none');
    expect(screen.getByTestId('wallet-history-count').textContent).toBe('0');
  });

  it('provides connected scenario with funded balances', () => {
    render(
      <MockWalletProvider scenario="connected">
        <TestWalletConsumer />
      </MockWalletProvider>
    );

    expect(screen.getByTestId('wallet-state').textContent).toBe('connected');
    expect(screen.getByTestId('wallet-connected').textContent).toBe('yes');
    expect(screen.getByTestId('wallet-pk').textContent).toBe(MOCK_WALLET_PUBLIC_KEYS.mainnet);
    expect(screen.getByTestId('wallet-xlm').textContent).toBe(MOCK_WALLET_BALANCES.funded.xlm);
    expect(screen.getByTestId('wallet-usdc').textContent).toBe(MOCK_WALLET_BALANCES.funded.usdc);
  });

  it('supports custom overrides with mock prop', () => {
    render(
      <MockWalletProvider
        scenario="connected"
        mock={{
          publicKey: 'GCUSTOMPUBLICKEY123',
          balance: { xlm: '50.0000000', usdc: '1000.00' },
        }}
      >
        <TestWalletConsumer />
      </MockWalletProvider>
    );

    expect(screen.getByTestId('wallet-state').textContent).toBe('connected');
    expect(screen.getByTestId('wallet-pk').textContent).toBe('GCUSTOMPUBLICKEY123');
    expect(screen.getByTestId('wallet-xlm').textContent).toBe('50.0000000');
    expect(screen.getByTestId('wallet-usdc').textContent).toBe('1000.00');
  });

  it('supports error and network mismatch scenarios', () => {
    const { rerender } = render(
      <MockWalletProvider scenario="error">
        <TestWalletConsumer />
      </MockWalletProvider>
    );

    expect(screen.getByTestId('wallet-state').textContent).toBe('error');
    expect(screen.getByTestId('wallet-error-flag').textContent).toBe('yes');
    expect(screen.getByTestId('wallet-error-msg').textContent).toContain('rejected');

    rerender(
      <MockWalletProvider scenario="network_mismatch">
        <TestWalletConsumer />
      </MockWalletProvider>
    );

    expect(screen.getByTestId('wallet-state').textContent).toBe('network_mismatch');
    expect(screen.getByTestId('wallet-error-flag').textContent).toBe('yes');
  });

  it('passes through custom action spies provided in value', () => {
    const connectSpy = vi.fn();
    const disconnectSpy = vi.fn();
    const retrySpy = vi.fn();

    const mockVal = createMockWalletConnection({
      scenario: 'disconnected',
      connect: connectSpy,
      disconnect: disconnectSpy,
      retry: retrySpy,
    });

    render(
      <MockWalletProvider value={mockVal}>
        <TestWalletConsumer />
      </MockWalletProvider>
    );

    screen.getByText('Connect').click();
    expect(connectSpy).toHaveBeenCalledWith('GNEWKEY', 'testnet');

    screen.getByText('Disconnect').click();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    screen.getByText('Retry').click();
    expect(retrySpy).toHaveBeenCalledTimes(1);
  });
});
