// Comprehensive tests for the mock wallet connection sandbox configuration
// and factory (Part 2). Pure logic — runs in the Node test project.

import { describe, it, expect, vi } from 'vitest';
import {
  MOCK_WALLET_PUBLIC_KEYS,
  MOCK_WALLET_BALANCES,
  MOCK_WALLET_SCENARIOS,
  createMockWalletConnection,
} from './mockWallet';
import type { WalletConnectionState } from './walletConnection';

const ALL_STATES: WalletConnectionState[] = [
  'disconnected',
  'connecting',
  'connected',
  'error',
  'insufficient_balance',
  'network_mismatch',
];

describe('MOCK_WALLET_PUBLIC_KEYS', () => {
  it('uses valid Stellar key format (G prefix, 56 characters)', () => {
    for (const key of Object.values(MOCK_WALLET_PUBLIC_KEYS)) {
      expect(key.startsWith('G')).toBe(true);
      expect(key.length).toBe(56);
    }
  });

  it('distinguishes mainnet from testnet', () => {
    expect(MOCK_WALLET_PUBLIC_KEYS.mainnet).not.toBe(MOCK_WALLET_PUBLIC_KEYS.testnet);
  });
});

describe('MOCK_WALLET_BALANCES', () => {
  it('provides a funded balance', () => {
    expect(MOCK_WALLET_BALANCES.funded).toEqual({ xlm: '10.0000000', usdc: '250.00' });
  });

  it('provides an empty balance', () => {
    expect(MOCK_WALLET_BALANCES.empty).toEqual({ xlm: '0.0000000', usdc: '0.00' });
  });
});

describe('MOCK_WALLET_SCENARIOS', () => {
  it('defines a preset scenario for every wallet state', () => {
    for (const state of ALL_STATES) {
      expect(MOCK_WALLET_SCENARIOS[state].state).toBe(state);
    }
  });

  it('keeps disconnected scenario without key, network, or balance', () => {
    const s = MOCK_WALLET_SCENARIOS.disconnected;
    expect(s.publicKey).toBeNull();
    expect(s.network).toBeNull();
    expect(s.balance).toBeNull();
    expect(s.error).toBeNull();
  });

  it('keeps connecting scenario with key but no balance', () => {
    const s = MOCK_WALLET_SCENARIOS.connecting;
    expect(s.publicKey).toBe(MOCK_WALLET_PUBLIC_KEYS.mainnet);
    expect(s.network).toBe('mainnet');
    expect(s.balance).toBeNull();
  });

  it('keeps connected scenario funded on mainnet', () => {
    const s = MOCK_WALLET_SCENARIOS.connected;
    expect(s.publicKey).toBe(MOCK_WALLET_PUBLIC_KEYS.mainnet);
    expect(s.network).toBe('mainnet');
    expect(s.balance).toEqual(MOCK_WALLET_BALANCES.funded);
  });

  it('keeps insufficient_balance scenario with an empty balance', () => {
    const s = MOCK_WALLET_SCENARIOS.insufficient_balance;
    expect(s.balance).toEqual(MOCK_WALLET_BALANCES.empty);
    expect(s.publicKey).toBe(MOCK_WALLET_PUBLIC_KEYS.testnet);
  });

  it('gives error scenarios a non-empty message', () => {
    expect(MOCK_WALLET_SCENARIOS.error.error).toBeTruthy();
    expect(MOCK_WALLET_SCENARIOS.network_mismatch.error).toBeTruthy();
  });
});

describe('createMockWalletConnection', () => {
  it('defaults to the disconnected scenario', () => {
    const wallet = createMockWalletConnection();
    expect(wallet.state).toBe('disconnected');
    expect(wallet.publicKey).toBeNull();
    expect(wallet.network).toBeNull();
    expect(wallet.balance).toBeNull();
    expect(wallet.error).toBeNull();
  });

  it('derives flags, label, and color from the scenario state', () => {
    for (const state of ALL_STATES) {
      const wallet = createMockWalletConnection({ scenario: state });
      expect(wallet.state).toBe(state);
      expect(wallet.isConnected).toBe(state === 'connected');
      expect(wallet.isConnecting).toBe(state === 'connecting');
      expect(wallet.isError).toBe(
        state === 'error' || state === 'network_mismatch' || state === 'insufficient_balance',
      );
      expect(wallet.label.length).toBeGreaterThan(0);
      expect(wallet.color).toMatch(/^var\(--.+\)$/);
    }
  });

  it('builds a connected mock value with key, network, and balance', () => {
    const wallet = createMockWalletConnection({ scenario: 'connected' });
    expect(wallet.publicKey).toBe(MOCK_WALLET_PUBLIC_KEYS.mainnet);
    expect(wallet.network).toBe('mainnet');
    expect(wallet.balance).toEqual(MOCK_WALLET_BALANCES.funded);
    expect(wallet.error).toBeNull();
  });

  it('applies public key, network, balance, and error overrides', () => {
    const wallet = createMockWalletConnection({
      scenario: 'connected',
      publicKey: 'GCUSTOM',
      network: 'testnet',
      balance: { xlm: '1.0000000', usdc: '5.00' },
      error: 'custom error',
    });
    expect(wallet.publicKey).toBe('GCUSTOM');
    expect(wallet.network).toBe('testnet');
    expect(wallet.balance).toEqual({ xlm: '1.0000000', usdc: '5.00' });
    expect(wallet.error).toBe('custom error');
    // state stays connected
    expect(wallet.state).toBe('connected');
  });

  it('allows clearing scenario fields with null overrides', () => {
    const wallet = createMockWalletConnection({
      scenario: 'connected',
      publicKey: null,
      network: null,
      balance: null,
      error: null,
    });
    expect(wallet.publicKey).toBeNull();
    expect(wallet.network).toBeNull();
    expect(wallet.balance).toBeNull();
    expect(wallet.error).toBeNull();
  });

  it('seeds history entries from options', () => {
    const entry = { state: 'connected' as const, timestamp: 1234 };
    const wallet = createMockWalletConnection({ history: [entry] });
    expect(wallet.history).toEqual([entry]);
  });

  it('defaults history to an empty array', () => {
    expect(createMockWalletConnection().history).toEqual([]);
  });

  it('returns no-op actions by default', () => {
    const wallet = createMockWalletConnection({ scenario: 'connected' });
    expect(() => wallet.connect('GKEY', 'mainnet')).not.toThrow();
    expect(() => wallet.disconnect()).not.toThrow();
    expect(() => wallet.setError('x')).not.toThrow();
    expect(() => wallet.setNetwork('testnet')).not.toThrow();
    expect(() => wallet.updateBalance({ xlm: '0', usdc: '0' })).not.toThrow();
    expect(() => wallet.clearError()).not.toThrow();
    expect(() => wallet.retry()).not.toThrow();
  });

  it('uses action overrides when provided', () => {
    const connect = vi.fn();
    const disconnect = vi.fn();
    const retry = vi.fn();
    const wallet = createMockWalletConnection({ connect, disconnect, retry });

    wallet.connect('GKEY', 'mainnet');
    wallet.disconnect();
    wallet.retry();

    expect(connect).toHaveBeenCalledWith('GKEY', 'mainnet');
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps state derived from scenario even when fields are overridden', () => {
    const wallet = createMockWalletConnection({
      scenario: 'error',
      publicKey: null,
      error: null,
    });
    // State stays 'error' regardless of field overrides.
    expect(wallet.state).toBe('error');
    expect(wallet.isError).toBe(true);
  });
});