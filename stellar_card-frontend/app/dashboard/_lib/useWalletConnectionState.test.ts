import { describe, it, expect } from 'vitest';
import { deriveWalletConnectionState } from './useWalletConnectionState';
import type { AgentStateName } from './types';

describe('deriveWalletConnectionState', () => {
  it('minted → disconnected, not connected, not ready', () => {
    const s = deriveWalletConnectionState('minted');
    expect(s.phase).toBe('disconnected');
    expect(s.isConnected).toBe(false);
    expect(s.isReady).toBe(false);
    expect(s.canTransact).toBe(false);
    expect(s.canTopUp).toBe(false);
    expect(s.isTransient).toBe(false);
  });

  it('initializing → connecting, transient, not connected', () => {
    const s = deriveWalletConnectionState('initializing');
    expect(s.phase).toBe('connecting');
    expect(s.isConnected).toBe(false);
    expect(s.isTransient).toBe(true);
    expect(s.canTransact).toBe(false);
    expect(s.canTopUp).toBe(false);
  });

  it('awaiting_funding → awaiting_funds, connected, can top up, cannot transact', () => {
    const s = deriveWalletConnectionState('awaiting_funding');
    expect(s.phase).toBe('awaiting_funds');
    expect(s.isConnected).toBe(true);
    expect(s.isTransient).toBe(true);
    expect(s.canTopUp).toBe(true);
    expect(s.canTransact).toBe(false);
    expect(s.isReady).toBe(false);
  });

  it('funded → ready phase, connected, can top up, cannot transact yet', () => {
    const s = deriveWalletConnectionState('funded');
    expect(s.phase).toBe('ready');
    expect(s.isConnected).toBe(true);
    expect(s.canTopUp).toBe(true);
    expect(s.canTransact).toBe(false);
    expect(s.isReady).toBe(false);
    expect(s.isTransient).toBe(false);
  });

  it('active → ready phase, connected, ready, can transact', () => {
    const s = deriveWalletConnectionState('active');
    expect(s.phase).toBe('ready');
    expect(s.isConnected).toBe(true);
    expect(s.isReady).toBe(true);
    expect(s.canTopUp).toBe(true);
    expect(s.canTransact).toBe(true);
    expect(s.isTransient).toBe(false);
  });

  it('unknown → disconnected, not connected', () => {
    const s = deriveWalletConnectionState('unknown');
    expect(s.phase).toBe('disconnected');
    expect(s.isConnected).toBe(false);
    expect(s.canTransact).toBe(false);
  });

  it('all states produce a non-empty label and description', () => {
    const states: AgentStateName[] = [
      'minted', 'initializing', 'awaiting_funding', 'funded', 'active', 'unknown',
    ];
    for (const state of states) {
      const s = deriveWalletConnectionState(state);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });
});
