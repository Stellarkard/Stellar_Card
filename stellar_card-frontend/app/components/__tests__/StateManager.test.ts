// Comprehensive tests for StateManager (Part 3)

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StateManager } from "../StateManager";
import { useStateManager } from "../StateManager";

describe("StateManager", () => {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("initializes with idle status", () => {
    const { result } = renderHook(() => useStateManager());
    expect(result.current.status).toBe("idle");
    expect(result.current.retryCount).toBe(0);
    expect(result.current.canRetry).toBe(true);
  });

  it("execute sets loading status and runs async function", async () => {
    const asyncFn = vi.fn(async () => ({ success: true }));
    const { result, waitFor } = renderHook(() => useStateManager({ asyncFn }));

    act(() => {
      result.current.retry();
    });

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toEqual({ success: true });
    expect(result.current.retryCount).toBe(0);
  });

  it("execute error sets error status", async () => {
    const asyncFn = vi.fn(async () => {
      throw new Error("Test error");
    });
    const { result, waitFor } = renderHook(() => useStateManager({ asyncFn }));

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("Test error");
  });

  it("retry increments retry count and delays", async () => {
    const asyncFn = vi.fn(async () => {
      throw new Error("Will fail twice then succeed");
    });
    let callCount = 0;

    asyncFn.mockImplementationOnce(() => {
      callCount++;
      throw new Error("First failure");
    });
    asyncFn.mockImplementationOnce(() => {
      callCount++;
      throw new Error("Second failure");
    });
    asyncFn.mockImplementationOnce(() => {
      callCount++;
      return { success: true };
    });

    const { waitFor } = renderHook(() => useStateManager({
      asyncFn,
      config: { retryAttempts: 3, retryDelay: 0 }
    }));

    act(() => {
      result.current.retry();
    });

    // First retry should fail
    await waitFor(() => {
      if (result.current.status === "error") return true;
    });

    // Second retry should fail
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      if (result.current.status === "error") return true;
    });

    // Third retry should succeed
    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.retryCount).toBe(2); // 2 retries after initial attempt
  });

  it("reset clears state and removes persisted data", () => {
    const { result } = renderHook(() => useStateManager({ persistKey: "test-key" }));

    // Set some state
    act(() => {
      result.current.retry(); // This will trigger loading
    });

    // Reset
    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.retryCount).toBe(0);
    expect(result.current.data).toBeNull();
  });

  it("setOptimisticData sets success status with data", () => {
    const { result } = renderHook(() => useStateManager());

    act(() => {
      result.current.setOptimisticData({ optimistic: true });
    });

    expect(result.current.status).toBe("success");
    expect(result.current.data).toEqual({ optimistic: true });
  });

  it("canRetry returns false when at retry limit", () => {
    const { result } = renderHook(() => useStateManager({
      config: { retryAttempts: 0 }
    }));

    expect(result.current.canRetry).toBe(false);

    act(() => {
      result.current.retry();
    });
    expect(result.current.canRetry).toBe(false);
  });

  it("canRetry returns true when within limit", () => {
    const { result } = renderHook(() => useStateManager({
      config: { retryAttempts: 3 }
    }));

    expect(result.current.canRetry).toBe(true);

    act(() => {
      result.current.retry();
    });
    expect(result.current.canRetry).toBe(true);

    act(() => {
      result.current.retry();
    });
    expect(result.current.canRetry).toBe(true);

    act(() => {
      result.current.retry();
    });
    expect(result.current.canRetry).toBe(false); // At limit
  });

  it("persisted state is loaded on mount", () => {
    const persistKey = "test-persist-key";

    // Mock localStorage
    const originalLocalStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: vi.fn(() => JSON.stringify({ persisted: true })),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      writable: true,
    });

    const asyncFn = vi.fn(() => Promise.resolve({ fromApi: true }));
    const { result } = renderHook(() => useStateManager({ asyncFn, persistKey }));

    expect(result.current.data).toEqual({ persisted: true });
    expect(result.current.status).toBe("success");

    // Restore
    Object.defineProperty(window, "localStorage", {
      value: originalLocalStorage,
      writable: true,
    });
  });

  it("execute with config onSuccess callback", async () => {
    const onSuccess = vi.fn();
    const asyncFn = vi.fn(async () => ({ result: "success" }));

    const { result, waitFor } = renderHook(() => useStateManager({
      asyncFn,
      config: { onSuccess }
    }));

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(onSuccess).toHaveBeenCalledWith({ result: "success" });
  });

  it("execute with config onError callback", async () => {
    const onError = vi.fn();
    const asyncFn = vi.fn(async () => {
      throw new Error("test error");
    });

    const { result, waitFor } = renderHook(() => useStateManager({
      asyncFn,
      config: { onError }
    }));

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(onError).toHaveBeenCalledWith(new Error("test error"));
  });
});