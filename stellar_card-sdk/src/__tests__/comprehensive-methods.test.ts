/**
 * Comprehensive unit tests for SDK methods - Part 3
 * Testing edge cases and error conditions for various SDK components
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { 
  Stellar_CardClient, 
  calculateExponentialBackoffDelay, 
  parseRetryAfterMs, 
  withRetry,
  Stellar_CardError,
  RateLimitError,
  AuthError,
  ValidationError
} from '../index';

describe('Stellar_CardClient - Edge Cases', () => {
  let client: Stellar_CardClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    client = new Stellar_CardClient({ 
      apiKey: 'test_key',
      baseUrl: 'https://api.test.com'
    });
  });

  test('should handle malformed JSON responses gracefully', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('Invalid JSON'))
    });

    await expect(client.getOrder('test-order-id')).rejects.toThrow(Stellar_CardError);
  });

  test('should validate order ID format strictly', async () => {
    await expect(client.getOrder('')).rejects.toThrow('Invalid order id');
    await expect(client.getOrder('a'.repeat(65))).rejects.toThrow('Invalid order id');
    await expect(client.getOrder('invalid@chars')).rejects.toThrow('Invalid order id');
  });

  test('should handle network timeout in fetchWithRetry', async () => {
    fetchSpy.mockImplementation(() => 
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Network timeout')), 100)
      )
    );

    await expect(client.getUsage()).rejects.toThrow();
  });

  test('should respect retry limits on transient failures', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null }
    });

    const client = new Stellar_CardClient({ 
      apiKey: 'test_key',
      retry: { attempts: 1, baseDelayMs: 10, maxDelayMs: 100 }
    });
    
    await expect(client.getUsage()).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(2); // Initial + 1 retry
  });
});

describe('Retry Logic - Edge Cases', () => {
  test('parseRetryAfterMs should handle edge cases', () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs(undefined)).toBeNull();
    expect(parseRetryAfterMs('')).toBeNull();
    expect(parseRetryAfterMs('   ')).toBeNull();
    expect(parseRetryAfterMs('invalid')).toBeNull();
    expect(parseRetryAfterMs('120.5')).toBe(120500);
    expect(parseRetryAfterMs('0')).toBe(0);
    expect(parseRetryAfterMs('-10')).toBe(0);
  });

  test('calculateExponentialBackoffDelay should respect all parameters', () => {
    const delay1 = calculateExponentialBackoffDelay({
      attempt: 0,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      factor: 3,
      jitter: 'none'
    });
    expect(delay1).toBe(100);

    const delay2 = calculateExponentialBackoffDelay({
      attempt: 2,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      factor: 3,
      jitter: 'none'
    });
    expect(delay2).toBe(900); // 100 * 3^2
  });

  test('withRetry should handle immediate failures', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Always fails'));
    
    await expect(withRetry({ 
      fn, 
      maxRetries: 0 
    })).rejects.toThrow('Always fails');
    
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('withRetry should respect custom retry predicate', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new RateLimitError())
      .mockRejectedValueOnce(new AuthError())
      .mockResolvedValueOnce('success');
    
    const isRetryable = (err: unknown) => err instanceof RateLimitError;
    
    await expect(withRetry({ 
      fn, 
      maxRetries: 2,
      baseDelayMs: 1,
      isRetryable 
    })).rejects.toThrow(AuthError);
    
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('Error Handling - Comprehensive', () => {
  test('should preserve error context through wrapping', () => {
    const originalError = new Error('Original cause');
    const wrappedError = new Stellar_CardError(
      'Wrapped message',
      'test_code',
      500,
      undefined,
      {
        source: 'test',
        operation: 'test_op',
        cause: originalError,
        recoveryHint: 'Try again'
      }
    );

    expect(wrappedError.context?.cause).toBe(originalError);
    expect(wrappedError.context?.recoveryHint).toBe('Try again');
    expect(wrappedError.toDebugString()).toContain('[source: test]');
    expect(wrappedError.toDebugString()).toContain('[recovery: Try again]');
  });

  test('should handle ValidationError with field context', () => {
    const error = new ValidationError('amount', 'must be positive');
    
    expect(error.field).toBe('amount');
    expect(error.message).toContain('amount');
    expect(error.message).toContain('must be positive');
    expect(error.code).toBe('validation_error');
    expect(error.status).toBe(400);
  });
});

describe('Client Configuration Edge Cases', () => {
  test('should handle config resolution failure gracefully', () => {
    // Mock require to simulate config unavailability (browser environment)
    const originalRequire = require;
    vi.stubGlobal('require', () => {
      throw new Error('Cannot find module');
    });

    expect(() => new Stellar_CardClient()).toThrow(AuthError);

    vi.unstubAllGlobals();
  });

  test('should validate baseUrl safety', () => {
    expect(() => new Stellar_CardClient({ 
      apiKey: 'test',
      baseUrl: 'http://unsafe.example.com' 
    })).not.toThrow(); // Should warn but not throw in this version
  });

  test('should handle missing apiKey appropriately', () => {
    expect(() => new Stellar_CardClient({ 
      apiKey: '',
      baseUrl: 'https://api.test.com'
    })).toThrow(AuthError);
    
    expect(() => new Stellar_CardClient({ 
      apiKey: '   ',
      baseUrl: 'https://api.test.com'
    })).toThrow(AuthError);
  });
});

describe('Pagination Edge Cases', () => {
  let client: Stellar_CardClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    client = new Stellar_CardClient({ apiKey: 'test_key' });
  });

  test('should handle empty pagination results', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([])
    });

    const page = await client.listOrdersPage({ limit: 10, offset: 0 });
    
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextOffset).toBeNull();
  });

  test('should validate pagination parameters', async () => {
    await expect(client.listOrdersPage({ limit: 0 })).rejects.toThrow(ValidationError);
    await expect(client.listOrdersPage({ offset: -1 })).rejects.toThrow(ValidationError);
    await expect(client.listOrdersPage({ limit: 1.5 })).rejects.toThrow(ValidationError);
  });

  test('should handle iteration with maxItems boundary', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { id: '1', status: 'delivered', amount_usdc: '10.00', payment_asset: 'usdc', created_at: '2023-01-01T00:00:00Z', updated_at: '2023-01-01T01:00:00Z' },
          { id: '2', status: 'delivered', amount_usdc: '20.00', payment_asset: 'usdc', created_at: '2023-01-01T00:00:00Z', updated_at: '2023-01-01T01:00:00Z' }
        ])
      });

    const items: any[] = [];
    for await (const item of client.iterateOrders({ maxItems: 1, limit: 10 })) {
      items.push(item);
    }
    
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('1');
  });
});