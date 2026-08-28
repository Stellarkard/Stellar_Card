import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withRetry } from '../retry';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('withRetry', () => {
  it('returns the value on first success without any retry', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry({ fn });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(0);
  });

  it('retries and succeeds on the second attempt', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('success');

    const promise = withRetry({ fn, maxRetries: 2, baseDelayMs: 100, maxDelayMs: 500 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 0);
    expect(fn).toHaveBeenNthCalledWith(2, 1);
  });

  it('throws the last error after exhausting all retries', async () => {
    const err = new Error('persistent');
    const fn = vi.fn().mockRejectedValue(err);

    // Attach the rejection handler before advancing timers to avoid an
    // unhandled-rejection event in between.
    const promise = withRetry({ fn, maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 });
    const caught = promise.catch((e) => e);
    await vi.runAllTimersAsync();

    const result = await caught;
    expect(result).toBe(err);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('respects maxRetries: 0 (no retries, single attempt)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(withRetry({ fn, maxRetries: 0 })).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops immediately when isRetryable returns false', async () => {
    const fatalErr = new Error('fatal');
    const fn = vi.fn().mockRejectedValue(fatalErr);
    const isRetryable = vi.fn().mockReturnValue(false);

    await expect(withRetry({ fn, maxRetries: 3, isRetryable })).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isRetryable).toHaveBeenCalledWith(fatalErr, 0);
  });

  it('retries when isRetryable returns true and stops when it returns false', async () => {
    const retryableErr = new Error('transient');
    const fatalErr = new Error('fatal');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableErr)
      .mockRejectedValueOnce(fatalErr);
    const isRetryable = vi.fn((err: unknown) => err === retryableErr);

    const promise = withRetry({ fn, maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, isRetryable });
    const caught = promise.catch((e) => e);
    await vi.runAllTimersAsync();

    const result = await caught;
    expect(result).toBe(fatalErr);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(isRetryable).toHaveBeenCalledTimes(2);
  });

  it('calls onRetry with the error, attempt index, and delay before sleeping', async () => {
    const err = new Error('retry-me');
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue('done');
    const onRetry = vi.fn();

    const promise = withRetry({ fn, maxRetries: 1, baseDelayMs: 100, maxDelayMs: 500, onRetry });
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    const [calledErr, calledAttempt, calledDelay] = onRetry.mock.calls[0];
    expect(calledErr).toBe(err);
    expect(calledAttempt).toBe(0);
    expect(typeof calledDelay).toBe('number');
    expect(calledDelay).toBeGreaterThanOrEqual(0);
    expect(calledDelay).toBeLessThanOrEqual(500);
  });

  it('passes the attempt index correctly across multiple retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValue('c');
    const onRetry = vi.fn();

    const promise = withRetry({ fn, maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, onRetry });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('c');
    expect(fn).toHaveBeenNthCalledWith(1, 0);
    expect(fn).toHaveBeenNthCalledWith(2, 1);
    expect(fn).toHaveBeenNthCalledWith(3, 2);
    expect(onRetry.mock.calls[0][1]).toBe(0);
    expect(onRetry.mock.calls[1][1]).toBe(1);
  });

  it('does not call onRetry on a non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    const onRetry = vi.fn();
    const isRetryable = () => false;

    await expect(withRetry({ fn, maxRetries: 2, isRetryable, onRetry })).rejects.toThrow();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('uses defaults when only fn is provided (maxRetries=2, baseDelayMs=500)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('t1'))
      .mockRejectedValueOnce(new Error('t2'))
      .mockResolvedValue('final');

    const promise = withRetry({ fn });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('final');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
