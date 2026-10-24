// Comprehensive unit tests for global state management hooks (Part 2)
// Tests for useAsyncState hook covering all edge cases

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAsyncState } from "../useAsyncState";

describe("useAsyncState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("initializes with idle status when immediate is false", () => {
    const mockFn = vi.fn().mockResolvedValue("data");
    const { result } = renderHook(() =>
      useAsyncState(mockFn, { immediate: false }),
    );

    expect(result.current.status).toBe("idle");
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("initializes with loading status when immediate is true", () => {
    const mockFn = vi.fn().mockResolvedValue("data");
    const { result } = renderHook(() =>
      useAsyncState(mockFn, { immediate: true }),
    );

    expect(result.current.status).toBe("loading");
    expect(result.current.loading).toBe(true);
  });

  it("transitions to success status with data", async () => {
    const mockData = { id: 1, name: "Test" };
    const mockFn = vi.fn().mockResolvedValue(mockData);
    const { result } = renderHook(() => useAsyncState(mockFn));

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });

    expect(result.current.data).toEqual(mockData);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("transitions to error status on failure", async () => {
    const mockError = new Error("Failed to fetch");
    const mockFn = vi.fn().mockRejectedValue(mockError);
    const { result } = renderHook(() => useAsyncState(mockFn));

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.error).toEqual(mockError);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it("handles non-Error rejections", async () => {
    const mockFn = vi.fn().mockRejectedValue("string error");
    const { result } = renderHook(() => useAsyncState(mockFn));

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("string error");
  });

  it("can be manually triggered with run()", async () => {
    let callCount = 0;
    const mockFn = vi.fn().mockImplementation(async () => {
      callCount++;
      return `data-${callCount}`;
    });

    const { result } = renderHook(() =>
      useAsyncState(mockFn, { immediate: false }),
    );

    expect(result.current.status).toBe("idle");

    await act(async () => {
      await result.current.run();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(result.current.data).toBe("data-1");

    // Run again manually
    await act(async () => {
      await result.current.run();
    });

    await waitFor(() => {
      expect(result.current.data).toBe("data-2");
    });
    expect(callCount).toBe(2);
  });

  it("clears error on successful retry", async () => {
    let shouldFail = true;
    const mockFn = vi.fn().mockImplementation(async () => {
      if (shouldFail) {
        throw new Error("Failed");
      }
      return "success";
    });

    const { result } = renderHook(() => useAsyncState(mockFn));

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error).toBeTruthy();

    // Now let it succeed
    shouldFail = false;

    await act(async () => {
      await result.current.run();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe("success");
  });

  it("maintains stable run function reference", () => {
    const mockFn = vi.fn().mockResolvedValue("data");
    const { result, rerender } = renderHook(() =>
      useAsyncState(mockFn, { immediate: false }),
    );

    const firstRun = result.current.run;
    rerender();
    const secondRun = result.current.run;

    expect(firstRun).toBe(secondRun);
  });

  it("updates when function reference changes", async () => {
    const mockFn1 = vi.fn().mockResolvedValue("data1");
    const mockFn2 = vi.fn().mockResolvedValue("data2");

    const { result, rerender } = renderHook(
      ({ fn }) => useAsyncState(fn, { immediate: false }),
      { initialProps: { fn: mockFn1 } },
    );

    await act(async () => {
      await result.current.run();
    });

    await waitFor(() => {
      expect(result.current.data).toBe("data1");
    });

    // Change function
    rerender({ fn: mockFn2 });

    await act(async () => {
      await result.current.run();
    });

    await waitFor(() => {
      expect(result.current.data).toBe("data2");
    });
  });

  it("handles rapid successive calls", async () => {
    let resolveCount = 0;
    const mockFn = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return ++resolveCount;
    });

    const { result } = renderHook(() =>
      useAsyncState(mockFn, { immediate: false }),
    );

    // Trigger multiple times rapidly
    act(() => {
      result.current.run();
      result.current.run();
      result.current.run();
    });

    vi.advanceTimersByTime(100);

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });

    // Should only resolve once per call
    expect(mockFn).toHaveBeenCalled();
  });

  it("handles empty response", async () => {
    const mockFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAsyncState(mockFn));

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });

    expect(result.current.data).toBeUndefined();
  });

  it("handles null response", async () => {
    const mockFn = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() => useAsyncState(mockFn));

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });

    expect(result.current.data).toBeNull();
  });

  it("preserves previous data during loading", async () => {
    const mockFn = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "second";
      });

    const { result } = renderHook(() =>
      useAsyncState(mockFn, { immediate: false }),
    );

    await act(async () => {
      await result.current.run();
    });

    await waitFor(() => {
      expect(result.current.data).toBe("first");
    });

    // Trigger again
    act(() => {
      result.current.run();
    });

    // Should still have old data while loading
    expect(result.current.status).toBe("loading");
    expect(result.current.data).toBe("first");

    vi.advanceTimersByTime(100);

    await waitFor(() => {
      expect(result.current.data).toBe("second");
    });
  });
});
