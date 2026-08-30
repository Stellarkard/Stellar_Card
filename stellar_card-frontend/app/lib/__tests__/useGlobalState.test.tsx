// Comprehensive unit tests for global state management hooks (Part 4)
// Tests for useGlobalState and GlobalStateProvider covering lifecycle, transitions, error handling, and edge cases.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { useGlobalState, GlobalStateProvider } from '../useGlobalState';

describe('Global State Management Hooks (Part 4)', () => {
  it('throws error when used outside of GlobalStateProvider', () => {
    expect(() => {
      renderHook(() => useGlobalState());
    }).toThrow('useGlobalState must be used inside a GlobalStateProvider');
  });

  it('initializes with default idle state', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalStateProvider>{children}</GlobalStateProvider>
    );

    const { result } = renderHook(() => useGlobalState(), { wrapper });

    expect(result.current.status).toBe('idle');
    expect(result.current.isIdle).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('initializes with custom initialStatus and initialError', () => {
    const customError = new Error('Initial test error');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalStateProvider initialStatus="error" initialError={customError}>
        {children}
      </GlobalStateProvider>
    );

    const { result } = renderHook(() => useGlobalState(), { wrapper });

    expect(result.current.status).toBe('error');
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBe(customError);
  });

  it('handles state transitions via setStatus and setError', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalStateProvider>{children}</GlobalStateProvider>
    );

    const { result } = renderHook(() => useGlobalState(), { wrapper });

    act(() => {
      result.current.setStatus('loading');
    });

    expect(result.current.status).toBe('loading');
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isIdle).toBe(false);

    act(() => {
      result.current.setStatus('success');
    });

    expect(result.current.status).toBe('success');
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isLoading).toBe(false);

    const error = new Error('Network timeout');
    act(() => {
      result.current.setError(error);
      result.current.setStatus('error');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.isError).toBe(true);
    expect(result.current.error).toEqual(error);
  });

  it('triggers onRetry callback and sets loading status', () => {
    const retrySpy = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalStateProvider initialStatus="error" onRetry={retrySpy}>
        {children}
      </GlobalStateProvider>
    );

    const { result } = renderHook(() => useGlobalState(), { wrapper });

    act(() => {
      result.current.retry?.();
    });

    expect(retrySpy).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('loading');
    expect(result.current.error).toBeNull();
  });

  it('resets state to idle and clears error on reset()', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <GlobalStateProvider initialStatus="error" initialError={new Error('Test error')}>
        {children}
      </GlobalStateProvider>
    );

    const { result } = renderHook(() => useGlobalState(), { wrapper });

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.isIdle).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
