import { useContext } from 'react';
import type { AsyncStatus } from './useAsyncState';

interface GlobalStateContext {
  status: AsyncStatus;
  error?: Error | null;
  isEmpty?: boolean;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  isIdle: boolean;
  retry?: () => void;
}

const stateContext: React.Context<GlobalStateContext | null> = null as any;

export function useGlobalState(): GlobalStateContext {
  const context = useContext(stateContext);
  if (!context) {
    throw new Error('useGlobalState must be used inside a GlobalStateProvider');
  }
  return context;
}

export function createGlobalStateContext() {
  return stateContext;
}
