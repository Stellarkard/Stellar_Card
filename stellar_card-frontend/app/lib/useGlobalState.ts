'use client';

import React, { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';
import type { AsyncStatus } from './useAsyncState';

export interface GlobalStateContextValue {
  status: AsyncStatus;
  error?: Error | null;
  isEmpty?: boolean;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  isIdle: boolean;
  retry?: () => void;
  setStatus: (status: AsyncStatus) => void;
  setError: (error: Error | null) => void;
  reset: () => void;
}

export interface GlobalStateProviderProps {
  children: ReactNode;
  initialStatus?: AsyncStatus;
  initialError?: Error | null;
  onRetry?: () => void;
}

const StateContext = createContext<GlobalStateContextValue | null>(null);

export function GlobalStateProvider({
  children,
  initialStatus = 'idle',
  initialError = null,
  onRetry,
}: GlobalStateProviderProps) {
  const [status, setStatus] = useState<AsyncStatus>(initialStatus);
  const [error, setError] = useState<Error | null>(initialError);

  const retry = useCallback(() => {
    setError(null);
    setStatus('loading');
    onRetry?.();
  }, [onRetry]);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  const value = useMemo<GlobalStateContextValue>(() => {
    return {
      status,
      error,
      isEmpty: status === 'success' && !error,
      isLoading: status === 'loading',
      isError: status === 'error',
      isSuccess: status === 'success',
      isIdle: status === 'idle',
      retry,
      setStatus,
      setError,
      reset,
    };
  }, [status, error, retry, reset]);

  return <StateContext.Provider value={value}>{children}</StateContext.Provider>;
}

export function useGlobalState(): GlobalStateContextValue {
  const context = useContext(StateContext);
  if (!context) {
    throw new Error('useGlobalState must be used inside a GlobalStateProvider');
  }
  return context;
}

export function createGlobalStateContext() {
  return StateContext;
}
