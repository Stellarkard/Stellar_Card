// Wallet connection state management for the dashboard.
// Provides a unified interface for tracking wallet connection status,
// connection states, and related UI states.

export type WalletConnectionState = 
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'insufficient_balance'
  | 'network_mismatch';

export interface WalletConnectionInfo {
  state: WalletConnectionState;
  publicKey: string | null;
  network: 'mainnet' | 'testnet' | null;
  balance: {
    xlm: string;
    usdc: string;
  } | null;
  error: string | null;
  lastConnected: string | null;
}

export interface WalletConnectionActions {
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  switchNetwork: (network: 'mainnet' | 'testnet') => Promise<void>;
}

export function getWalletStateLabel(state: WalletConnectionState): string {
  const labels: Record<WalletConnectionState, string> = {
    disconnected: 'Wallet not connected',
    connecting: 'Connecting to wallet...',
    connected: 'Wallet connected',
    error: 'Connection error',
    insufficient_balance: 'Insufficient balance',
    network_mismatch: 'Network mismatch',
  };
  return labels[state];
}

export function getWalletStateColor(state: WalletConnectionState): string {
  const colors: Record<WalletConnectionState, string> = {
    disconnected: 'var(--fg-dim)',
    connecting: 'var(--yellow)',
    connected: 'var(--green)',
    error: 'var(--red)',
    insufficient_balance: 'var(--yellow)',
    network_mismatch: 'var(--red)',
  };
  return colors[state];
}

export function isWalletConnected(state: WalletConnectionState): boolean {
  return state === 'connected';
}

export function isWalletConnecting(state: WalletConnectionState): boolean {
  return state === 'connecting';
}

export function isWalletError(state: WalletConnectionState): boolean {
  return state === 'error' || state === 'network_mismatch' || state === 'insufficient_balance';
}
