/**
 * Tests for the new error utility helpers added in #153:
 *   - wrapValidationError
 *   - buildErrorChain
 *   - isRetryableByDefault
 */
import { describe, expect, it } from 'vitest';

import {
  Stellar_CardError,
  NetworkError,
  RateLimitError,
  ServiceUnavailableError,
  TimeoutError,
  PriceUnavailableError,
  AuthError,
  InvalidAmountError,
  OrderFailedError,
  ValidationError,
  buildErrorChain,
  isRetryableByDefault,
  wrapError,
  wrapValidationError,
} from '../errors';

// ── wrapValidationError ───────────────────────────────────────────────────────

describe('wrapValidationError', () => {
  it('returns a ValidationError for the given field and reason', () => {
    const err = wrapValidationError('amount_usdc', 'must be a positive decimal string');

    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toBeInstanceOf(Stellar_CardError);
    expect(err.field).toBe('amount_usdc');
    expect(err.message).toContain('amount_usdc');
    expect(err.message).toContain('must be a positive decimal string');
    expect(err.code).toBe('validation_error');
    expect(err.status).toBe(400);
  });

  it('attaches optional context', () => {
    const err = wrapValidationError('recipient', 'invalid Stellar address', {
      operation: 'create_payment',
      source: 'sdk_validation',
    });

    expect(err.context?.operation).toBe('create_payment');
    expect(err.context?.source).toBe('sdk_validation');
  });

  it('works without context', () => {
    const err = wrapValidationError('field', 'bad value');
    expect(err).toBeInstanceOf(ValidationError);
  });
});

// ── buildErrorChain ───────────────────────────────────────────────────────────

describe('buildErrorChain', () => {
  it('returns the message of a plain Error', () => {
    const err = new Error('root cause');
    expect(buildErrorChain(err)).toBe('root cause');
  });

  it('returns the message of a Stellar_CardError', () => {
    const err = new Stellar_CardError('api error', 'api_err', 500);
    expect(buildErrorChain(err)).toBe('api error');
  });

  it('chains Stellar_CardError → cause Error', () => {
    const cause = new Error('root cause');
    const outer = new Stellar_CardError('outer', 'outer_code', 500, undefined, { cause });
    const chain = buildErrorChain(outer);
    expect(chain).toBe('outer → root cause');
  });

  it('chains multiple levels of Stellar_CardError', () => {
    const root = new Error('disk full');
    const middle = new Stellar_CardError('write failed', 'write_err', 0, undefined, { cause: root });
    const top = new Stellar_CardError('order failed', 'order_err', 500, undefined, { cause: middle });

    const chain = buildErrorChain(top);
    expect(chain).toBe('order failed → write failed → disk full');
  });

  it('handles non-Error values', () => {
    expect(buildErrorChain('string error')).toBe('string error');
    expect(buildErrorChain(42)).toBe('42');
    expect(buildErrorChain(null)).toBe('');
  });

  it('stops on circular references to avoid infinite loops', () => {
    const err = new Error('circular') as Error & { cause?: unknown };
    err.cause = err; // circular
    // Should terminate without throwing
    expect(() => buildErrorChain(err)).not.toThrow();
  });
});

// ── isRetryableByDefault ──────────────────────────────────────────────────────

describe('isRetryableByDefault', () => {
  it('returns true for RateLimitError', () => {
    expect(isRetryableByDefault(new RateLimitError())).toBe(true);
  });

  it('returns true for ServiceUnavailableError', () => {
    expect(isRetryableByDefault(new ServiceUnavailableError())).toBe(true);
  });

  it('returns true for NetworkError', () => {
    expect(isRetryableByDefault(new NetworkError('timeout'))).toBe(true);
  });

  it('returns true for TimeoutError', () => {
    expect(isRetryableByDefault(new TimeoutError('waitForCard', 30000))).toBe(true);
  });

  it('returns true for PriceUnavailableError', () => {
    expect(isRetryableByDefault(new PriceUnavailableError())).toBe(true);
  });

  it('returns false for AuthError', () => {
    expect(isRetryableByDefault(new AuthError())).toBe(false);
  });

  it('returns false for InvalidAmountError', () => {
    expect(isRetryableByDefault(new InvalidAmountError())).toBe(false);
  });

  it('returns false for plain Error', () => {
    expect(isRetryableByDefault(new Error('random'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isRetryableByDefault('string')).toBe(false);
    expect(isRetryableByDefault(null)).toBe(false);
    expect(isRetryableByDefault(42)).toBe(false);
  });

  it('can be used as isRetryable predicate with wrapError', () => {
    const retryableErr = new RateLimitError();
    const nonRetryableErr = new AuthError();

    expect(isRetryableByDefault(retryableErr)).toBe(true);
    expect(isRetryableByDefault(nonRetryableErr)).toBe(false);
  });
});

// ── wrapError — raw preservation (#153 regression guard) ─────────────────────

describe('wrapError raw preservation', () => {
  it('preserves raw payload when enhancing a Stellar_CardError', () => {
    const raw = { server_detail: 'debug info', request_id: 'abc-123' };
    const base = new Stellar_CardError('base error', 'base_code', 500, raw);
    const enhanced = wrapError(base, { operation: 'retry_attempt' });

    // raw must survive the enhancement
    expect((enhanced as Stellar_CardError).raw).toEqual(raw);
    expect(enhanced.context?.operation).toBe('retry_attempt');
  });

  it('sets raw to undefined when wrapping a plain Error', () => {
    const plain = new Error('plain');
    const wrapped = wrapError(plain, { source: 'test' });
    expect(wrapped.raw).toBeUndefined();
  });
});
