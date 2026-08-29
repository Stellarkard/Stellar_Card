// React hook that combines wallet connection state with connection actions.
// Provides a unified interface for components to interact with the wallet.

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { WalletConnectionState } from './walletConnection';
import {
  getWalletStateLabel,
  getWalletStateColor,
  isWalletConnected,
  isWalletConnecting,
  isWalletError,
} from './walletConnection';

export interface WalletConnectionHistoryEntry {
  state: WalletConnectionState;
  timestamp: number;
  publicKey?: string;
  network?: 'mainnet' | 'testnet';
}

export interface UseWalletConnectionOptions {
  initialState?: WalletConnectionState;
  onStateChange?: (state: WalletConnectionState) => void;
  maxHistorySize?: number;
}

export interface UseWalletConnectionReturn {
  state: WalletConnectionState;
  publicKey: string | null;
  network: 'mainnet' | 'testnet' | null;
  balance: { xlm: string; usdc: string } | null;
  error: string | null;
  history: WalletConnectionHistoryEntry[];
  isConnected: boolean;
  isConnecting: boolean;
  isError: boolean;
  label: string;
  color: string;
  connect: (publicKey: string, network: 'mainnet' | 'testnet') => void;
  disconnect: () => void;
  setError: (error: string) => void;
  setNetwork: (network: 'mainnet' | 'testnet') => void;
  updateBalance: (balance: { xlm: string; usdc: string }) => void;
  clearError: () => void;
  retry: () => void;
}

export function useWalletConnection(
  options: UseWalletConnectionOptions = {},
): UseWalletConnectionReturn {
  const {
    initialState = 'disconnected',
    onStateChange,
    maxHistorySize = 50,
  } = options;

  const [state, setState] = useState<WalletConnectionState>(initialState);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [network, setNetwork] = useState<'mainnet' | 'testnet' | null>(null);
  const [balance, setBalance] = useState<{ xlm: string; usdc: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<WalletConnectionHistoryEntry[]>([]);

  const lastStateRef = useRef(state);
  const connectAttemptRef = useRef<string | null>(null);

  const addToHistory = useCallback(
    (entry: WalletConnectionHistoryEntry) => {
      setHistory((prev) => {
        const next = [...prev, entry];
        return next.length > maxHistorySize ? next.slice(-maxHistorySize) : next;
      });
    },
    [maxHistorySize],
  );

  const updateState = useCallback(
    (nextState: WalletConnectionState) => {
      if (nextState === lastStateRef.current) return;
      lastStateRef.current = nextState;
      setState(nextState);
      onStateChange?.(nextState);
    },
    [onStateChange],
  );

  const connect = useCallback(
    (key: string, net: 'mainnet' | 'testnet') => {
      connectAttemptRef.current = key;
      updateState('connecting');
      setPublicKey(key);
      setNetwork(net);
      setError(null);
      addToHistory({
        state: 'connecting',
        timestamp: Date.now(),
        publicKey: key,
        network: net,
      });
    },
    [updateState, addToHistory],
  );

  const disconnect = useCallback(() => {
    updateState('disconnected');
    setPublicKey(null);
    setNetwork(null);
    setBalance(null);
    setError(null);
    connectAttemptRef.current = null;
    addToHistory({
      state: 'disconnected',
      timestamp: Date.now(),
    });
  }, [updateState, addToHistory]);

  const setErrorState = useCallback(
    (err: string) => {
      updateState('error');
      setError(err);
      addToHistory({
        state: 'error',
        timestamp: Date.now(),
        publicKey: publicKey ?? undefined,
        network: network ?? undefined,
      });
    },
    [updateState, addToHistory, publicKey, network],
  );

  const setNetworkState = useCallback(
    (net: 'mainnet' | 'testnet') => {
      if (network && network !== net) {
        updateState('network_mismatch');
        addToHistory({
          state: 'network_mismatch',
          timestamp: Date.now(),
          publicKey: publicKey ?? undefined,
          network: net,
        });
      } else {
        setNetwork(net);
      }
    },
    [network, publicKey, updateState, addToHistory],
  );

  const updateBalance = useCallback(
    (newBalance: { xlm: string; usdc: string }) => {
      setBalance(newBalance);
      if (state === 'connecting' || state === 'error') {
        updateState('connected');
        addToHistory({
          state: 'connected',
          timestamp: Date.now(),
          publicKey: publicKey ?? undefined,
          network: network ?? undefined,
        });
      }
    },
    [state, publicKey, network, updateState, addToHistory],
  );

  const clearError = useCallback(() => {
    setError(null);
    if (state === 'error' || state === 'network_mismatch') {
      updateState('disconnected');
    }
  }, [state, updateState]);

  const retry = useCallback(() => {
    if (connectAttemptRef.current && network) {
      connect(connectAttemptRef.current, network);
    }
  }, [connect, network]);

  // Notify on state changes
  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  return {
    state,
    publicKey,
    network,
    balance,
    error,
    history,
    isConnected: isWalletConnected(state),
    isConnecting: isWalletConnecting(state),
    isError: isWalletError(state),
    label: getWalletStateLabel(state),
    color: getWalletStateColor(state),
    connect,
    disconnect,
    setError: setErrorState,
    setNetwork: setNetworkState,
    updateBalance,
    clearError,
    retry,
  };
}
