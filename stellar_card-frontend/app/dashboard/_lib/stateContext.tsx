'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

type StateType = 'idle' | 'loading' | 'empty' | 'error' | 'success';

interface StateContextValue {
  state: StateType;
  error?: Error | string;
  message?: string;
  setLoading: () => void;
  setEmpty: (message?: string) => void;
  setError: (error: Error | string, message?: string) => void;
  setSuccess: (message?: string) => void;
  setIdle: () => void;
  reset: () => void;
  isLoading: boolean;
  isEmpty: boolean;
  isError: boolean;
  isSuccess: boolean;
}

const StateContext = createContext<StateContextValue | null>(null);

export function StateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StateType>('idle');
  const [error, setErrorState] = useState<Error | string | undefined>();
  const [message, setMessage] = useState<string>();

  const setLoading = useCallback(() => {
    setState('loading');
    setErrorState(undefined);
    setMessage(undefined);
  }, []);

  const setEmpty = useCallback((msg?: string) => {
    setState('empty');
    setErrorState(undefined);
    setMessage(msg);
  }, []);

  const setError = useCallback((err: Error | string, msg?: string) => {
    setState('error');
    setErrorState(err);
    setMessage(msg || (typeof err === 'string' ? err : err.message));
  }, []);

  const setSuccess = useCallback((msg?: string) => {
    setState('success');
    setErrorState(undefined);
    setMessage(msg);
  }, []);

  const setIdle = useCallback(() => {
    setState('idle');
    setErrorState(undefined);
    setMessage(undefined);
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setErrorState(undefined);
    setMessage(undefined);
  }, []);

  const value: StateContextValue = {
    state,
    error,
    message,
    setLoading,
    setEmpty,
    setError,
    setSuccess,
    setIdle,
    reset,
    isLoading: state === 'loading',
    isEmpty: state === 'empty',
    isError: state === 'error',
    isSuccess: state === 'success',
  };

  return (
    <StateContext.Provider value={value}>
      {children}
    </StateContext.Provider>
  );
}

export function usePageState(): StateContextValue {
  const ctx = useContext(StateContext);
  if (!ctx) {
    throw new Error('usePageState must be used inside <StateProvider>');
  }
  return ctx;
}
