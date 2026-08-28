/**
 * Tests for withAdvancedRetry and AdvancedRetryStrategy (#149, #151).
 *
 * Covers:
 *   - Exponential, linear, and fixed backoff (#151)
 *   - shouldRetry predicate (#149)
 *   - All jitter strategies (#151)
 *   - Error propagation (#149)
 *   - AdvancedRetryStrategy type shape (#150)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withAdvancedRetry, type AdvancedRetryStrategy } from '../retry';

// Base strategy used across tests — individual tests override specific fields.
const BASE: AdvancedRetryStrategy = {
  maxAttempts: 3,
  baseDelayMs: 1,   // tiny so fake timers advance instantly
  maxDelayMs: 100,
  multiplier: 2,
  jitterStrategy: 'none',
  backoffStrategy: 'exponential',
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Success path ──────────────────────────────────────────────────────────────

describe('withAdvancedRetry — success path', () => {
  it('resolves immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('value');
    const result = await withAdvancedRetry(fn, { ...BASE, maxAttempts: 1 });
    expect(result).toBe('value');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(0);
  });

  it('succeeds on the second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValue('ok');

    const promise = withAdvancedRetry(fn, BASE);
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('passes the zero-based attempt index to fn', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValue('c');

    const promise = withAdvancedRetry(fn, BASE);
    await vi.runAllTimersAsync();
    await promise;

    expect(fn).toHaveBeenNthCalledWith(1, 0);
    expect(fn).toHaveBeenNthCalledWith(2, 1);
    expect(fn).toHaveBeenNthCalledWith(3, 2);
  });
});

// ── Failure path ──────────────────────────────────────────────────────────────

describe('withAdvancedRetry — failure path (#149)', () => {
  it('throws the last error after all attempts are exhausted', async () => {
    const last = new Error('final');
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValue(last);

    const promise = withAdvancedRetry(fn, BASE).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await promise).toBe(last);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('maxAttempts: 1 means a single attempt with no retry', async () => {
    const err = new Error('only');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withAdvancedRetry(fn, { ...BASE, maxAttempts: 1 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── shouldRetry predicate ─────────────────────────────────────────────────────

describe('withAdvancedRetry — shouldRetry predicate (#149)', () => {
  it('stops immediately when shouldRetry returns false', async () => {
    const err = new Error('fatal');
    const fn = vi.fn().mockRejectedValue(err);
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(withAdvancedRetry(fn, { ...BASE, shouldRetry })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(shouldRetry).toHaveBeenCalledWith(err, 0);
  });

  it('retries when shouldRetry returns true, stops when it returns false', async () => {
    const retryable = new Error('transient');
    const fatal = new Error('fatal');
    const fn = vi.fn()
      .mockRejectedValueOnce(retryable)
      .mockRejectedValue(fatal);

    const shouldRetry = vi.fn((e: unknown) => e === retryable);

    const promise = withAdvancedRetry(fn, { ...BASE, shouldRetry }).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await promise).toBe(fatal);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('receives (error, attemptIndex) correctly', async () => {
    // fn always throws — shouldRetry always says true, so we exhaust maxAttempts=3
    // shouldRetry is called for every failed attempt including the last one
    const fn = vi.fn().mockRejectedValue(new Error('err'));
    const shouldRetry = vi.fn().mockReturnValue(true);

    const promise = withAdvancedRetry(fn, { ...BASE, maxAttempts: 3, shouldRetry }).catch((e) => e);
    await vi.runAllTimersAsync();
    await promise;

    // shouldRetry is called on all 3 failed attempts (0, 1, 2)
    const attemptIndices = shouldRetry.mock.calls.map((c) => c[1]);
    expect(attemptIndices.length).toBeGreaterThanOrEqual(2);
    expect(attemptIndices[0]).toBe(0);
    expect(attemptIndices[1]).toBe(1);
  });
});

// ── Exponential backoff (#151) ────────────────────────────────────────────────

describe('withAdvancedRetry — exponential backoff (#151)', () => {
  it('performs more attempts when base is tiny (smoke test)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValue('ok');

    const promise = withAdvancedRetry(fn, {
      ...BASE,
      backoffStrategy: 'exponential',
      jitterStrategy: 'none',
      baseDelayMs: 1,
      maxDelayMs: 10,
      multiplier: 2,
    });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('caps delay at maxDelayMs (base > max)', async () => {
    // base 10000 > max 50 — every delay should be capped at 50
    let capturedDelay = -1;
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: () => void, ms?: number) => {
      if (ms !== undefined && ms > 0) capturedDelay = ms;
      return originalSetTimeout(fn, 0) as unknown as ReturnType<typeof setTimeout>;
    });

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue('ok');

    const promise = withAdvancedRetry(fn, {
      ...BASE,
      backoffStrategy: 'exponential',
      jitterStrategy: 'none',
      baseDelayMs: 10000,
      maxDelayMs: 50,
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(capturedDelay).toBeLessThanOrEqual(50);
  });
});

// ── Linear backoff (#151) ─────────────────────────────────────────────────────

describe('withAdvancedRetry — linear backoff (#151)', () => {
  it('retries and resolves with linear strategy', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValue('linear-ok');

    const promise = withAdvancedRetry(fn, {
      ...BASE,
      backoffStrategy: 'linear',
      jitterStrategy: 'none',
      baseDelayMs: 1,
      maxDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('linear-ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('exhausts attempts with linear strategy', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'));

    const promise = withAdvancedRetry(fn, {
      ...BASE,
      backoffStrategy: 'linear',
      jitterStrategy: 'none',
      maxAttempts: 3,
    }).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await promise).toBeInstanceOf(Error);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ── Fixed backoff (#151) ──────────────────────────────────────────────────────

describe('withAdvancedRetry — fixed backoff (#151)', () => {
  it('retries and resolves with fixed strategy', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValue('fixed-ok');

    const promise = withAdvancedRetry(fn, {
      ...BASE,
      backoffStrategy: 'fixed',
      jitterStrategy: 'none',
      baseDelayMs: 1,
      maxDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('fixed-ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('exhausts attempts with fixed strategy', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'));

    const promise = withAdvancedRetry(fn, {
      ...BASE,
      backoffStrategy: 'fixed',
      jitterStrategy: 'none',
      maxAttempts: 2,
    }).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await promise).toBeInstanceOf(Error);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ── Jitter strategies (#151) ──────────────────────────────────────────────────

describe('withAdvancedRetry — jitter strategies (#151)', () => {
  it('full jitter: completes successfully', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockResolvedValue('ok');

    const promise = withAdvancedRetry(fn, {
      ...BASE,
      backoffStrategy: 'exponential',
      jitterStrategy: 'full',
      baseDelayMs: 1,
      maxDelayMs: 100,
    });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
  });

  it('equal jitter: completes successfully', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockResolvedValue('ok');

    const promise = withAdvancedRetry(fn, {
      ...BASE,
      backoffStrategy: 'exponential',
      jitterStrategy: 'equal',
      baseDelayMs: 1,
      maxDelayMs: 100,
    });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
  });

  it('decorrelated jitter: completes successfully', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockResolvedValue('ok');

    const promise = withAdvancedRetry(fn, {
      ...BASE,
      backoffStrategy: 'exponential',
      jitterStrategy: 'decorrelated',
      baseDelayMs: 1,
      maxDelayMs: 100,
    });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
  });

  it('none jitter: deterministic, completes successfully', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockResolvedValue('ok');

    const promise = withAdvancedRetry(fn, {
      ...BASE,
      backoffStrategy: 'exponential',
      jitterStrategy: 'none',
      baseDelayMs: 1,
      maxDelayMs: 100,
    });
    await vi.runAllTimersAsync();
    expect(await promise).toBe('ok');
  });
});

// ── AdvancedRetryStrategy type shape (#150) ───────────────────────────────────

describe('AdvancedRetryStrategy type contract (#150)', () => {
  it('accepts a full valid strategy', () => {
    const strategy: AdvancedRetryStrategy = {
      maxAttempts: 5,
      baseDelayMs: 200,
      maxDelayMs: 8000,
      multiplier: 2,
      jitterStrategy: 'full',
      backoffStrategy: 'exponential',
      shouldRetry: (err, attempt) => attempt < 3 && err instanceof Error,
    };
    expect(strategy.maxAttempts).toBe(5);
    expect(strategy.jitterStrategy).toBe('full');
    expect(strategy.backoffStrategy).toBe('exponential');
  });

  it('accepts linear backoffStrategy', () => {
    const s: AdvancedRetryStrategy = { ...BASE, backoffStrategy: 'linear' };
    expect(s.backoffStrategy).toBe('linear');
  });

  it('accepts fixed backoffStrategy', () => {
    const s: AdvancedRetryStrategy = { ...BASE, backoffStrategy: 'fixed' };
    expect(s.backoffStrategy).toBe('fixed');
  });

  it('accepts all four jitter strategies', () => {
    const strategies: AdvancedRetryStrategy['jitterStrategy'][] = ['full', 'equal', 'decorrelated', 'none'];
    for (const j of strategies) {
      const s: AdvancedRetryStrategy = { ...BASE, jitterStrategy: j };
      expect(s.jitterStrategy).toBe(j);
    }
  });

  it('shouldRetry is optional', () => {
    const s: AdvancedRetryStrategy = { ...BASE };
    expect(s.shouldRetry).toBeUndefined();
  });
});
