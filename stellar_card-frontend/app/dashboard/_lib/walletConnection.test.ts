// Unit tests for walletConnection state management — pure logic, no DOM.

import { describe, it, expect } from 'vitest';
import {
  getWalletStateLabel,
  getWalletStateColor,
  isWalletConnected,
  isWalletConnecting,
  isWalletError,
} from './walletConnection';
import type { WalletConnectionState } from './walletConnection';

describe('getWalletStateLabel', () => {
  it('returns a label for disconnected state', () => {
    expect(getWalletStateLabel('disconnected')).toBe('Wallet not connected');
  });

  it('returns a label for connecting state', () => {
    expect(getWalletStateLabel('connecting')).toBe('Connecting to wallet...');
  });

  it('returns a label for connected state', () => {
    expect(getWalletStateLabel('connected')).toBe('Wallet connected');
  });

  it('returns a label for error state', () => {
    expect(getWalletStateLabel('error')).toBe('Connection error');
  });

  it('returns a label for insufficient_balance state', () => {
    expect(getWalletStateLabel('insufficient_balance')).toBe('Insufficient balance');
  });

  it('returns a label for network_mismatch state', () => {
    expect(getWalletStateLabel('network_mismatch')).toBe('Network mismatch');
  });

  it('returns a label for every WalletConnectionState value', () => {
    const states: WalletConnectionState[] = [
      'disconnected', 'connecting', 'connected', 'error', 'insufficient_balance', 'network_mismatch',
    ];
    for (const state of states) {
      const label = getWalletStateLabel(state);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('getWalletStateColor', () => {
  it('returns dim color for disconnected state', () => {
    expect(getWalletStateColor('disconnected')).toBe('var(--fg-dim)');
  });

  it('returns yellow color for connecting state', () => {
    expect(getWalletStateColor('connecting')).toBe('var(--yellow)');
  });

  it('returns green color for connected state', () => {
    expect(getWalletStateColor('connected')).toBe('var(--green)');
  });

  it('returns red color for error state', () => {
    expect(getWalletStateColor('error')).toBe('var(--red)');
  });

  it('returns yellow color for insufficient_balance state', () => {
    expect(getWalletStateColor('insufficient_balance')).toBe('var(--yellow)');
  });

  it('returns red color for network_mismatch state', () => {
    expect(getWalletStateColor('network_mismatch')).toBe('var(--red)');
  });

  it('returns a CSS variable color for every state', () => {
    const states: WalletConnectionState[] = [
      'disconnected', 'connecting', 'connected', 'error', 'insufficient_balance', 'network_mismatch',
    ];
    for (const state of states) {
      const color = getWalletStateColor(state);
      expect(color).toMatch(/^var\(--.+\)$/);
    }
  });
});

describe('isWalletConnected', () => {
  it('returns true only for connected state', () => {
    expect(isWalletConnected('connected')).toBe(true);
  });

  it('returns false for all other states', () => {
    const states: WalletConnectionState[] = [
      'disconnected', 'connecting', 'error', 'insufficient_balance', 'network_mismatch',
    ];
    for (const state of states) {
      expect(isWalletConnected(state)).toBe(false);
    }
  });
});

describe('isWalletConnecting', () => {
  it('returns true only for connecting state', () => {
    expect(isWalletConnecting('connecting')).toBe(true);
  });

  it('returns false for all other states', () => {
    const states: WalletConnectionState[] = [
      'disconnected', 'connected', 'error', 'insufficient_balance', 'network_mismatch',
    ];
    for (const state of states) {
      expect(isWalletConnecting(state)).toBe(false);
    }
  });
});

describe('isWalletError', () => {
  it('returns true for error state', () => {
    expect(isWalletError('error')).toBe(true);
  });

  it('returns true for network_mismatch state', () => {
    expect(isWalletError('network_mismatch')).toBe(true);
  });

  it('returns true for insufficient_balance state', () => {
    expect(isWalletError('insufficient_balance')).toBe(true);
  });

  it('returns false for non-error states', () => {
    const states: WalletConnectionState[] = [
      'disconnected', 'connecting', 'connected',
    ];
    for (const state of states) {
      expect(isWalletError(state)).toBe(false);
    }
  });
});
