import { useCallback, useReducer } from 'react';

type State<T> =
  | { status: 'idle'; data?: T }
  | { status: 'loading'; data?: T }
  | { status: 'success'; data: T }
  | { status: 'empty'; data?: T }
  | { status: 'error'; error: Error; data?: T };

type Action<T> =
  | { type: 'RESET' }
  | { type: 'REQUEST' }
  | { type: 'SUCCESS'; payload: T }
  | { type: 'ERROR'; error: Error }
  | { type: 'EMPTY' };

function reducer<T>(state: State<T>, action: Action<T>): State<T> {
  switch (action.type) {
    case 'RESET':
      return { status: 'idle' };
    case 'REQUEST':
      return { status: 'loading', data: state.data };
    case 'SUCCESS':
      return { status: 'success', data: action.payload };
    case 'ERROR':
      return { status: 'error', error: action.error, data: state.data };
    case 'EMPTY':
      return { status: 'empty', data: state.data };
  }
}

export interface AsyncStateResult<T> {
  data?: T;
  status: State<T>['status'];
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
  isEmpty: boolean;
  error?: Error;
  execute: (promise: Promise<T>) => Promise<T | undefined>;
  reset: () => void;
  setEmpty: () => void;
}

export function useAsyncState<T = void>(initialData?: T): AsyncStateResult<T> {
  const [state, dispatch] = useReducer(reducer<T>, {
    status: 'idle',
    data: initialData,
  });

  const execute = useCallback(async (promise: Promise<T>) => {
    dispatch({ type: 'REQUEST' });
    try {
      const data = await promise;
      if (!data) {
        dispatch({ type: 'EMPTY' });
        return undefined;
      }
      dispatch({ type: 'SUCCESS', payload: data });
      return data;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dispatch({ type: 'ERROR', error });
      return undefined;
    }
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const setEmpty = useCallback(() => {
    dispatch({ type: 'EMPTY' });
  }, []);

  return {
    data: state.data,
    status: state.status,
    isLoading: state.status === 'loading',
    isSuccess: state.status === 'success',
    isError: state.status === 'error',
    isEmpty: state.status === 'empty',
    error: state.status === 'error' ? state.error : undefined,
    execute,
    reset,
    setEmpty,
  };
}
