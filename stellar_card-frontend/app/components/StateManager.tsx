// StateManager - Advanced state orchestration for complex async flows
// Part 3: Final integration with retry logic, optimistic updates, and state persistence

"use client";

import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type { AsyncStatus } from "../lib/useAsyncState";
import {
  DEFAULT_RETRY_CONFIG,
  buildPersistKey,
  retryDelayForAttempt,
  isWithinRetryLimit,
} from "./stateConfig";

interface StateConfig {
  retryAttempts?: number;
  retryDelay?: number;
  persistKey?: string;
  onSuccess?: (data: any) => void;
  onError?: (error: Error) => void;
}

interface StateManagerContext {
  status: AsyncStatus;
  error: Error | null;
  retryCount: number;
  canRetry: boolean;
  retry: () => Promise<void>;
  reset: () => void;
  setOptimisticData: (data: any) => void;
}

const StateManagerContext = createContext<StateManagerContext | null>(null);

interface Props {
  children: ReactNode;
  asyncFn: () => Promise<any>;
  config?: StateConfig;
}

export function StateManager({ children, asyncFn, config = {} }: Props) {
  const {
    retryAttempts = DEFAULT_RETRY_CONFIG.attempts,
    retryDelay = DEFAULT_RETRY_CONFIG.baseDelayMs,
    persistKey,
    onSuccess,
    onError,
  } = config;

  const [status, setStatus] = useState<AsyncStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [data, setData] = useState<any>(null);

  // Load persisted state on mount
  useEffect(() => {
    if (persistKey && typeof window !== "undefined") {
      const stored = localStorage.getItem(buildPersistKey(persistKey));
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setData(parsed);
          setStatus("success");
        } catch {
          // Invalid stored data, ignore
        }
      }
    }
  }, [persistKey]);

  const execute = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      const result = await asyncFn();
      setData(result);
      setStatus("success");
      setRetryCount(0);

      // Persist successful state
      if (persistKey && typeof window !== "undefined") {
        localStorage.setItem(buildPersistKey(persistKey), JSON.stringify(result));
      }

      onSuccess?.(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setStatus("error");
      onError?.(error);
    }
  }, [asyncFn, persistKey, onSuccess, onError]);

  const retry = useCallback(async () => {
    if (!isWithinRetryLimit(retryCount, retryAttempts)) return;

    setRetryCount((prev) => prev + 1);

    // Exponential backoff
    const delay = retryDelayForAttempt(retryCount, retryDelay);
    await new Promise((resolve) => setTimeout(resolve, delay));

    await execute();
  }, [retryCount, retryAttempts, retryDelay, execute]);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setRetryCount(0);
    setData(null);

    if (persistKey && typeof window !== "undefined") {
      localStorage.removeItem(buildPersistKey(persistKey));
    }
  }, [persistKey]);

  const setOptimisticData = useCallback((optimisticData: any) => {
    setData(optimisticData);
    setStatus("success");
  }, []);

  const value: StateManagerContext = {
    status,
    error,
    retryCount,
    canRetry: isWithinRetryLimit(retryCount, retryAttempts),
    retry,
    reset,
    setOptimisticData,
  };

  return (
    <StateManagerContext.Provider value={value}>
      {children}
    </StateManagerContext.Provider>
  );
}

export function useStateManager() {
  const context = useContext(StateManagerContext);
  if (!context) {
    throw new Error("useStateManager must be used within StateManager");
  }
  return context;
}
