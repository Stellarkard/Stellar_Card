// Comprehensive unit tests for global state management hooks (Part 4)
// Tests for useGlobalState and GlobalStateProvider covering lifecycle, transitions, error handling, and edge cases.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { useGlobalState, GlobalStateProvider, createGlobalStateContext } from '../useGlobalState';

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

// Cross-component sharing, derived flags, provider isolation and the
// exported context factory.
describe('Global State Management Hooks (Part 4) - sharing and derived flags', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <GlobalStateProvider>{children}</GlobalStateProvider>
  );

  afterEach(() => {
    cleanup();
  });

  it('shares one state instance across sibling consumers', () => {
    const seen: string[] = [];

    function Consumer({ label }: { label: string }) {
      const { status, setStatus } = useGlobalState();
      seen.push(`${label}:${status}`);
      return (
        <button type="button" onClick={() => setStatus('success')}>
          {label}
        </button>
      );
    }

    render(
      <GlobalStateProvider>
        <Consumer label="left" />
        <Consumer label="right" />
      </GlobalStateProvider>,
    );

    expect(seen).toEqual(['left:idle', 'right:idle']);

    // Updating from one consumer re-renders every subscriber with the same value.
    fireEvent.click(screen.getByText('left'));

    expect(seen.filter((entry) => entry.endsWith(':success'))).toEqual([
      'left:success',
      'right:success',
    ]);
  });

  it('derives isEmpty only for a clean success state', () => {
    const { result } = renderHook(() => useGlobalState(), { wrapper });

    expect(result.current.isEmpty).toBe(false);

    act(() => {
      result.current.setStatus('success');
    });

    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isEmpty).toBe(true);

    act(() => {
      result.current.setError(new Error('stale error'));
    });

    expect(result.current.status).toBe('success');
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isEmpty).toBe(false);
  });

  it('supports retry without an onRetry handler', () => {
    const { result } = renderHook(() => useGlobalState(), { wrapper });

    act(() => {
      result.current.setStatus('error');
      result.current.setError(new Error('network down'));
    });

    expect(() => {
      act(() => {
        result.current.retry?.();
      });
    }).not.toThrow();

    expect(result.current.status).toBe('loading');
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('keeps separate providers isolated from one another', () => {
    const failure = new Error('second provider failed');

    function Probe({ id }: { id: string }) {
      const { status, isEmpty } = useGlobalState();
      return (
        <span data-testid={id}>
          {status}:{String(isEmpty)}
        </span>
      );
    }

    render(
      <>
        <GlobalStateProvider initialStatus="loading">
          <Probe id="primary" />
        </GlobalStateProvider>
        <GlobalStateProvider initialStatus="success" initialError={failure}>
          <Probe id="secondary" />
        </GlobalStateProvider>
      </>,
    );

    expect(screen.getByTestId('primary').textContent).toBe('loading:false');
    expect(screen.getByTestId('secondary').textContent).toBe('success:false');
  });

  it('createGlobalStateContext exposes the shared context with a null default', () => {
    const context = createGlobalStateContext();

    function BareConsumer() {
      const value = React.useContext(context);
      return <span data-testid="bare">{value ? 'provided' : 'empty'}</span>;
    }

    render(<BareConsumer />);

    expect(screen.getByTestId('bare').textContent).toBe('empty');
  });
});
