// useAsyncState — minimal hook for async data fetching with loading /
// error / data states. Replaces the common useState+useEffect boilerplate
// scattered across dashboard pages with a single, consistent API.
//
// Usage:
//   const { data, loading, error, run } = useAsyncState(fetchSomething);
//   // run() is also exposed for manual re-triggers (e.g., after a mutation).

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  data: T | null;
  status: AsyncStatus;
  loading: boolean;
  error: Error | null;
  /** Re-run the async function manually. */
  run: () => Promise<void>;
}

/**
 * useAsyncState
 *
 * @param fn  Async function that resolves to data. A new function reference
 *            triggers a re-fetch; wrap in useCallback if you want to control
 *            when that happens.
 * @param opts.immediate  Run on mount (default: true).
 */
export function useAsyncState<T>(
  fn: () => Promise<T>,
  opts: { immediate?: boolean } = {},
): AsyncState<T> {
  const { immediate = true } = opts;
  const [status, setStatus] = useState<AsyncStatus>(immediate ? 'loading' : 'idle');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Keep a stable ref to fn so the run() callback doesn't change on every
  // render when fn itself is a closure created inline.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const result = await fnRef.current();
      setData(result);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (immediate) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    data,
    status,
    loading: status === 'loading',
    error,
    run,
  };
}
