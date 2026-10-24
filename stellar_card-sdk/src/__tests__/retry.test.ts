import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calculateExponentialBackoffDelay,
  parseRetryAfterMs,
  sleep,
  withRetry,
  isRetryableHttpStatus,
  isTransientError,
} from '../retry';

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds values', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs('0.5')).toBe(500);
  });

  it('parses HTTP-date values', () => {
    const nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:03 GMT', nowMs)).toBe(3000);
  });

  it('returns null for malformed values', () => {
    expect(parseRetryAfterMs('not-a-date')).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
  });
});

describe('calculateExponentialBackoffDelay', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies full jitter inside the exponential window', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(
      calculateExponentialBackoffDelay({
        attempt: 2,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      }),
    ).toBe(200);
  });

  it('respects Retry-After when it is longer than client backoff', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    expect(
      calculateExponentialBackoffDelay({
        attempt: 0,
        baseDelayMs: 500,
        maxDelayMs: 5000,
        retryAfter: '2',
      }),
    ).toBe(2000);
  });

  it('supports disabling jitter', () => {
    expect(
      calculateExponentialBackoffDelay({
        attempt: 1,
        baseDelayMs: 250,
        maxDelayMs: 1000,
        jitter: 'none',
      }),
    ).toBe(500);
  });
});

describe('sleep with AbortSignal', () => {
  it('resolves after delay', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('cancels delay and rejects immediately when abort signal is triggered', async () => {
    const controller = new AbortController();
    const sleepPromise = sleep(5000, controller.signal);

    controller.abort(new Error('Operation cancelled by caller'));

    await expect(sleepPromise).rejects.toThrow('Operation cancelled by caller');
  });

  it('rejects immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Pre-aborted'));

    await expect(sleep(5000, controller.signal)).rejects.toThrow('Pre-aborted');
  });
});

describe('HTTP status and network error classification', () => {
  it('recognizes 429 and 503 as retryable HTTP statuses', () => {
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
    expect(isRetryableHttpStatus(502)).toBe(true);
    expect(isRetryableHttpStatus(504)).toBe(true);
  });

  it('recognizes 400 and 401 as non-retryable client errors', () => {
    expect(isRetryableHttpStatus(400)).toBe(false);
    expect(isRetryableHttpStatus(401)).toBe(false);
    expect(isRetryableHttpStatus(403)).toBe(false);
    expect(isRetryableHttpStatus(404)).toBe(false);
  });

  it('detects network disconnects and socket errors as transient', () => {
    expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransientError(new Error('socket hang up'))).toBe(true);
    expect(isTransientError(new Error('network disconnect detected'))).toBe(true);
  });

  it('rejects 400 and 401 errors as non-transient', () => {
    expect(isTransientError({ status: 400, message: 'Bad Request' })).toBe(false);
    expect(isTransientError({ status: 401, message: 'Unauthorized' })).toBe(false);
  });
});

describe('withRetry comprehensive execution tests (#704)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retries on HTTP 429 status up to configured limit', async () => {
    let callCount = 0;
    const maxRetries = 3;

    await expect(
      withRetry({
        fn: async () => {
          callCount++;
          const err: any = new Error('Too Many Requests');
          err.status = 429;
          throw err;
        },
        maxRetries,
        baseDelayMs: 1,
        maxDelayMs: 5,
        isRetryable: (err: any) => isRetryableHttpStatus(err.status),
      }),
    ).rejects.toThrow('Too Many Requests');

    // 1 initial call + 3 retries = 4 total attempts
    expect(callCount).toBe(maxRetries + 1);
  });

  it('retries on HTTP 503 status and succeeds before limit', async () => {
    let attempts = 0;

    const result = await withRetry({
      fn: async (attempt) => {
        attempts++;
        if (attempt < 2) {
          const err: any = new Error('Service Unavailable');
          err.status = 503;
          throw err;
        }
        return 'success_after_503';
      },
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
      isRetryable: (err: any) => isRetryableHttpStatus(err.status),
    });

    expect(result).toBe('success_after_503');
    expect(attempts).toBe(3); // attempt 0 (fail), attempt 1 (fail), attempt 2 (success)
  });

  it('fails immediately on HTTP 400 client error without retrying', async () => {
    let callCount = 0;

    await expect(
      withRetry({
        fn: async () => {
          callCount++;
          const err: any = new Error('Bad Request: Invalid parameters');
          err.status = 400;
          throw err;
        },
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 5,
        isRetryable: (err: any) => isRetryableHttpStatus(err.status),
      }),
    ).rejects.toThrow('Bad Request: Invalid parameters');

    expect(callCount).toBe(1);
  });

  it('fails immediately on HTTP 401 client error without retrying', async () => {
    let callCount = 0;

    await expect(
      withRetry({
        fn: async () => {
          callCount++;
          const err: any = new Error('Unauthorized');
          err.status = 401;
          throw err;
        },
        maxRetries: 3,
        baseDelayMs: 1,
        maxDelayMs: 5,
        isRetryable: (err: any) => isRetryableHttpStatus(err.status),
      }),
    ).rejects.toThrow('Unauthorized');

    expect(callCount).toBe(1);
  });

  it('retries on network disconnect socket errors (ECONNRESET)', async () => {
    let attempts = 0;

    const result = await withRetry({
      fn: async () => {
        attempts++;
        if (attempts === 1) {
          const socketErr: any = new Error('read ECONNRESET');
          socketErr.code = 'ECONNRESET';
          throw socketErr;
        }
        return 'connected';
      },
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 5,
      isRetryable: (err) => isTransientError(err),
    });

    expect(result).toBe('connected');
    expect(attempts).toBe(2);
  });

  it('respects Retry-After header delaying subsequent attempt', async () => {
    const onRetry = vi.fn();

    await expect(
      withRetry({
        fn: async () => {
          const err: any = new Error('Rate limited');
          err.status = 429;
          err.retryAfter = '2'; // 2 seconds
          throw err;
        },
        maxRetries: 1,
        baseDelayMs: 10,
        maxDelayMs: 5000,
        jitter: 'none',
        onRetry,
        isRetryable: () => true,
      }),
    ).rejects.toThrow('Rate limited');

    expect(onRetry).toHaveBeenCalledTimes(1);
    const delayArg = onRetry.mock.calls[0][2];
    expect(delayArg).toBe(2000); // 2 seconds = 2000 ms from Retry-After
  });

  it('cancels pending retry delays and rejects when abort signal fires', async () => {
    const controller = new AbortController();
    let attempts = 0;

    const retryPromise = withRetry({
      fn: async () => {
        attempts++;
        const err: any = new Error('Server Unavailable');
        err.status = 503;
        throw err;
      },
      maxRetries: 5,
      baseDelayMs: 10000, // Long delay
      signal: controller.signal,
      isRetryable: () => true,
    });

    // Abort after 50ms while in the middle of retry backoff delay
    setTimeout(() => {
      controller.abort(new Error('Aborted by user test'));
    }, 50);

    await expect(retryPromise).rejects.toThrow('Aborted by user test');
    expect(attempts).toBe(1); // Aborted before second attempt
  });
});
