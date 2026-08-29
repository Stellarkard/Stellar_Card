// Comprehensive tests for StateManager (Part 2)
// Tests retry logic, optimistic updates, and state persistence

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, act, waitFor } from "@testing-library/react";
import { StateManager, useStateManager } from "../StateManager";

describe("StateManager", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("initializes with idle status", () => {
    const mockFn = vi.fn().mockResolvedValue("data");

    const { result } = renderHook(() => useStateManager(), {
      wrapper: ({ children }) => (
        <StateManager asyncFn={mockFn}>{children}</StateManager>
      ),
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.retryCount).toBe(0);
  });

  it("executes retry with exponential backoff", async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("Failed");
      }
      return "success";
    });

    const { result } = renderHook(() => useStateManager(), {
      wrapper: ({ children }) => (
        <StateManager asyncFn={mockFn} config={{ retryAttempts: 3 }}>
          {children}
        </StateManager>
      ),
    });

    // First retry
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.retryCount).toBe(1);

    // Fast-forward delay
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    // Second retry
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.retryCount).toBe(2);

    // Fast-forward with exponential backoff
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });

    expect(callCount).toBe(3);
  });

  it("respects maximum retry attempts", async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error("Always fails"));

    const { result } = renderHook(() => useStateManager(), {
      wrapper: ({ children }) => (
        <StateManager asyncFn={mockFn} config={{ retryAttempts: 2 }}>
          {children}
        </StateManager>
      ),
    });

    // First retry
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.canRetry).toBe(true);

    // Second retry
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.canRetry).toBe(false);
    expect(result.current.retryCount).toBe(2);

    // Third retry should not execute
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.retryCount).toBe(2);
  });

  it("persists state to localStorage", async () => {
    const mockData = { id: 1, value: "test" };
    const mockFn = vi.fn().mockResolvedValue(mockData);

    renderHook(() => useStateManager(), {
      wrapper: ({ children }) => (
        <StateManager asyncFn={mockFn} config={{ persistKey: "test-key" }}>
          {children}
        </StateManager>
      ),
    });

    await waitFor(() => {
      const stored = localStorage.getItem("state_test-key");
      expect(stored).toBeTruthy();
      expect(JSON.parse(stored!)).toEqual(mockData);
    });
  });

  it("loads persisted state on mount", () => {
    const persistedData = { id: 2, value: "persisted" };
    localStorage.setItem("state_test-key", JSON.stringify(persistedData));

    const mockFn = vi.fn().mockResolvedValue("new data");

    const { result } = renderHook(() => useStateManager(), {
      wrapper: ({ children }) => (
        <StateManager asyncFn={mockFn} config={{ persistKey: "test-key" }}>
          {children}
        </StateManager>
      ),
    });

    expect(result.current.status).toBe("success");
  });

  it("handles optimistic updates", async () => {
    const mockFn = vi.fn().mockResolvedValue("actual data");

    const { result } = renderHook(() => useStateManager(), {
      wrapper: ({ children }) => (
        <StateManager asyncFn={mockFn}>{children}</StateManager>
      ),
    });

    act(() => {
      result.current.setOptimisticData({ id: 1, value: "optimistic" });
    });

    expect(result.current.status).toBe("success");
  });

  it("resets state and clears persistence", async () => {
    localStorage.setItem("state_test-key", JSON.stringify({ data: "test" }));

    const mockFn = vi.fn().mockResolvedValue("data");

    const { result } = renderHook(() => useStateManager(), {
      wrapper: ({ children }) => (
        <StateManager asyncFn={mockFn} config={{ persistKey: "test-key" }}>
          {children}
        </StateManager>
      ),
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.retryCount).toBe(0);
    expect(localStorage.getItem("state_test-key")).toBeNull();
  });

  it("calls onSuccess callback", async () => {
    const onSuccess = vi.fn();
    const mockData = "success data";
    const mockFn = vi.fn().mockResolvedValue(mockData);

    renderHook(() => useStateManager(), {
      wrapper: ({ children }) => (
        <StateManager asyncFn={mockFn} config={{ onSuccess }}>
          {children}
        </StateManager>
      ),
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(mockData);
    });
  });

  it("calls onError callback", async () => {
    const onError = vi.fn();
    const mockError = new Error("Test error");
    const mockFn = vi.fn().mockRejectedValue(mockError);

    renderHook(() => useStateManager(), {
      wrapper: ({ children }) => (
        <StateManager asyncFn={mockFn} config={{ onError }}>
          {children}
        </StateManager>
      ),
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(mockError);
    });
  });

  it("throws error when useStateManager used outside provider", () => {
    expect(() => {
      renderHook(() => useStateManager());
    }).toThrow("useStateManager must be used within StateManager");
  });

  it("handles invalid persisted data gracefully", () => {
    localStorage.setItem("state_test-key", "invalid json{");

    const mockFn = vi.fn().mockResolvedValue("data");

    const { result } = renderHook(() => useStateManager(), {
      wrapper: ({ children }) => (
        <StateManager asyncFn={mockFn} config={{ persistKey: "test-key" }}>
          {children}
        </StateManager>
      ),
    });

    expect(result.current.status).toBe("idle");
  });
});
