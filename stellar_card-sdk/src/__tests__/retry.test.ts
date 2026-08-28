import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateExponentialBackoffDelay, parseRetryAfterMs } from '../retry';

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
