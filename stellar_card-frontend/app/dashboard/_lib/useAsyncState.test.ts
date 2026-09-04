// Comprehensive tests for useAsyncState hook (Part 3)

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderHook } from "@testing-library/react-hooks";
import { useAsyncState } from "./useAsyncState";

describe("useAsyncState", () => {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("initializes with idle status", () => {
    const { result } = renderHook(() => useAsyncState());
    expect(result.current.status).toBe("idle");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });

  it("execute sets loading status", async () => {
    const { result, waitFor } = renderHook(() => useAsyncState());
    const promise = delay(100);

    act(() => {
      result.current.execute(promise);
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.status).toBe("loading"));

    // Complete the promise
    result.current.execute(delay(100));
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("execute success sets data and success status", async () => {
    const testData = { items: [1, 2, 3] };
    const { result, waitFor } = renderHook(() => useAsyncState());

    act(() => {
      result.current.execute(Promise.resolve(testData));
    });

    await waitFor(() => {
      expect(result.current.status).toBe("success");
      expect(result.current.data).toEqual(testData);
    });
  });

  it("execute error sets error status", async () => {
    const { result, waitFor } = renderHook(() => useAsyncState());

    act(() => {
      result.current.execute(Promise.reject(new Error("Test error")));
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("Test error");
  });

  it("execute with initial data sets success status", async () => {
    const initialData = { value: 42 };
    const { result } = renderHook(() => useAsyncState(initialData));

    expect(result.current.status).toBe("success");
    expect(result.current.data).toEqual(initialData);
    expect(result.current.isSuccess).toBe(true);
  });

  it("reset returns to idle status", async () => {
    const { result, waitFor } = renderHook(() => useAsyncState());

    // Simulate a completed execution
    act(() => {
      result.current.execute(Promise.resolve({ data: 1 }));
    });
    await waitFor(() => expect(result.current.status).toBe("success"));

    // Reset
    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("setEmpty sets empty status", async () => {
    const { result, waitFor } = renderHook(() => useAsyncState());

    act(() => {
      result.current.execute(Promise.resolve(null));
    });
    await waitFor(() => expect(result.current.status).toBe("empty"));

    expect(result.current.isEmpty).toBe(true);
  });

  it("execute rejects non-error values", async () => {
    const { result, waitFor } = renderHook(() => useAsyncState());

    act(() => {
      result.current.execute(Promise.reject("not an error"));
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("not an error");
  });

  it("execute returns undefined on error", async () => {
    const { result, waitFor } = renderHook(() => useAsyncState());

    act(() => {
      result.current.execute(Promise.reject(new Error("error")));
    });

    await waitFor(() => {
      expect(result.current.data).toBeUndefined();
      expect(result.current.status).toBe("error");
    });
  });

  it("execute returns undefined on null data", async () => {
    const { result, waitFor } = renderHook(() => useAsyncState());

    act(() => {
      result.current.execute(Promise.resolve(null));
    });

    await waitFor(() => {
      expect(result.current.data).toBeUndefined();
      expect(result.current.isEmpty).toBe(true);
    });
  });

  it("execute preserves previous data on error", async () => {
    const { result, waitFor } = renderHook(() => useAsyncState(initialData => initialData));

    // First success
    act(() => {
      result.current.execute(Promise.resolve({ first: true }));
    });
    await waitFor(() => expect(result.current.data).toEqual({ first: true }));

    // Then error
    act(() => {
      result.current.execute(Promise.reject(new Error("error")));
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    // Data should still be the previous successful data
    expect(result.current.data).toEqual({ first: true });
  });
});

function renderHook<T>(factory: () => T) {
  const result = useAsyncState();
  return {
    ...result,
    execute: result.execute,
    reset: result.reset,
    setEmpty: result.setEmpty,
  };
}

// Helper to create a hook instance with initial data
function initialData<T>(data?: T): T {
  return data as T;
}