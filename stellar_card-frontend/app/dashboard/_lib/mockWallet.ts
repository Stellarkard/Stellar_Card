// Core configuration and factory for the mock wallet connection sandbox
// (Part 2 of the web3-mock roadmap).
//
// Part 1 introduced the MockWalletContext and the useWalletConnection
// hook. This module consolidates the values that callers previously had to
// hand-roll every time they set up a mock wallet — preset scenarios,
// placeholder keys and balances, and a factory that builds a complete
// `UseWalletConnectionReturn` in one call for tests, Storybook, and demos.

import {
  getWalletStateLabel,
  getWalletStateColor,
  isWalletConnected,
  isWalletConnecting,
  isWalletError,
  type WalletConnectionState,
} from './walletConnection';
import type {
  UseWalletConnectionReturn,
  WalletConnectionHistoryEntry,
} from './useWalletConnection';
/** Networks supported by the mock wallet sandbox. */
export type MockWalletNetwork = 'mainnet' | 'testnet';

/** Placeholder public keys with valid Stellar key format (G…, 56 chars). */
export const MOCK_WALLET_PUBLIC_KEYS = {
  mainnet: 'GBIPW5ELSZAHOV4DKRY7GNU3CJQX6FMT2BIPW5ELSZAHOV4DKRY7GNU3',
  testnet: 'GTCJQX6FMT2BIPW5ELSZAHOV4DKRY7GNU3CJQX6FMT2BIPW5ELSZAHOV',
} as const;

/** Placeholder balances used by the preset scenarios. */
export const MOCK_WALLET_BALANCES = {
  funded: { xlm: '10.0000000', usdc: '250.00' },
  empty: { xlm: '0.0000000', usdc: '0.00' },
} as const;

/** The full set of preset sandbox scenarios, one per wallet state. */
export interface MockWalletScenarioConfig {
  state: WalletConnectionState;
  publicKey: string | null;
  network: MockWalletNetwork | null;
  balance: { xlm: string; usdc: string } | null;
  error: string | null;
}

/**
 * Preset scenario configurations keyed by wallet connection state.
 * These are the "core configuration" defaults for the sandbox.
 */
export const MOCK_WALLET_SCENARIOS: Readonly<Record<WalletConnectionState, MockWalletScenarioConfig>> = {
  disconnected: {
    state: 'disconnected',
    publicKey: null,
    network: null,
    balance: null,
    error: null,
  },
  connecting: {
    state: 'connecting',
    publicKey: MOCK_WALLET_PUBLIC_KEYS.mainnet,
    network: 'mainnet',
    balance: null,
    error: null,
  },
  connected: {
    state: 'connected',
    publicKey: MOCK_WALLET_PUBLIC_KEYS.mainnet,
    network: 'mainnet',
    balance: MOCK_WALLET_BALANCES.funded,
    error: null,
  },
  error: {
    state: 'error',
    publicKey: MOCK_WALLET_PUBLIC_KEYS.mainnet,
    network: 'mainnet',
    balance: null,
    error: 'Wallet rejected the connection request.',
  },
  insufficient_balance: {
    state: 'insufficient_balance',
    publicKey: MOCK_WALLET_PUBLIC_KEYS.testnet,
    network: 'testnet',
    balance: MOCK_WALLET_BALANCES.empty,
    error: null,
  },
  network_mismatch: {
    state: 'network_mismatch',
    publicKey: MOCK_WALLET_PUBLIC_KEYS.testnet,
    network: 'testnet',
    balance: null,
    error: 'Wallet is connected to the wrong network.',
  },
};

/** Options accepted by {@link createMockWalletConnection}. */
export interface CreateMockWalletOptions {
  /** Preset scenario to base the mock value on. Defaults to `disconnected`. */
  scenario?: WalletConnectionState;
  /** Override the scenario's public key (or clear it with `null`). */
  publicKey?: string | null;
  /** Override the scenario's network (or clear it with `null`). */
  network?: MockWalletNetwork | null;
  /** Override the scenario's balance (or clear it with `null`). */
  balance?: { xlm: string; usdc: string } | null;
  /** Override the scenario's error message (or clear it with `null`). */
  error?: string | null;
  /** History entries to seed the mock value with. */
  history?: WalletConnectionHistoryEntry[];
  /** Replace the default no-op actions (useful for spies in tests). */
  connect?: UseWalletConnectionReturn['connect'];
  disconnect?: UseWalletConnectionReturn['disconnect'];
  setError?: UseWalletConnectionReturn['setError'];
  setNetwork?: UseWalletConnectionReturn['setNetwork'];
  updateBalance?: UseWalletConnectionReturn['updateBalance'];
  clearError?: UseWalletConnectionReturn['clearError'];
  retry?: UseWalletConnectionReturn['retry'];
}

const noop = () => {};

/**
 * Build a complete `UseWalletConnectionReturn` value for a mock sandbox.
 *
 * The value is a static snapshot derived from a preset scenario; actions are
 * no-ops unless overridden. This is intended for tests, Storybook stories,
 * and demos where a live wallet connection is not available.
 *
 * @example
 * const wallet = createMockWalletConnection({ scenario: 'connected' });
 * <MockWalletProvider value={wallet}>…</MockWalletProvider>
 */
export function createMockWalletConnection(
  options: CreateMockWalletOptions = {},
): UseWalletConnectionReturn {
  const scenario = options.scenario ?? 'disconnected';
  const config = MOCK_WALLET_SCENARIOS[scenario];

  const publicKey = options.publicKey !== undefined ? options.publicKey : config.publicKey;
  const network = options.network !== undefined ? options.network : config.network;
  const balance = options.balance !== undefined ? options.balance : config.balance;
  const error = options.error !== undefined ? options.error : config.error;
  const history = options.history ?? [];

  return {
    state: config.state,
    publicKey,
    network,
    balance,
    error,
    history,
    isConnected: isWalletConnected(config.state),
    isConnecting: isWalletConnecting(config.state),
    isError: isWalletError(config.state),
    label: getWalletStateLabel(config.state),
    color: getWalletStateColor(config.state),
    connect: options.connect ?? noop,
    disconnect: options.disconnect ?? noop,
    setError: options.setError ?? noop,
    setNetwork: options.setNetwork ?? noop,
    updateBalance: options.updateBalance ?? noop,
    clearError: options.clearError ?? noop,
    retry: options.retry ?? noop,
  };
}