/**
 * Verifies that the browser entry point (src/browser.ts) exports only
 * Node.js-agnostic symbols and that those symbols behave correctly.
 */
import { describe, it, expect } from 'vitest';

// Set the env var before importing to satisfy assertSafeBaseUrl
process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

import {
  Stellar_CardClient,
  calculateExponentialBackoffDelay,
  parseRetryAfterMs,
  sleep,
  paginate,
  iteratePages,
  resolveNetworkConfig,
  getDefaultSorobanRpcUrl,
  getDefaultHorizonUrl,
  Stellar_CardError,
  AuthError,
  RateLimitError,
  ServiceUnavailableError,
  SpendLimitError,
  OrderFailedError,
  WaitTimeoutError,
} from '../browser';

describe('browser entry point exports', () => {
  it('exports Stellar_CardClient', () => {
    expect(typeof Stellar_CardClient).toBe('function');
  });

  it('Stellar_CardClient can be instantiated in a browser-like context', () => {
    const client = new Stellar_CardClient({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000/v1',
    });
    expect(client).toBeInstanceOf(Stellar_CardClient);
  });

  it('exports retry utilities', () => {
    expect(typeof calculateExponentialBackoffDelay).toBe('function');
    expect(typeof parseRetryAfterMs).toBe('function');
    expect(typeof sleep).toBe('function');
  });

  it('exports pagination utilities', () => {
    expect(typeof paginate).toBe('function');
    expect(typeof iteratePages).toBe('function');
  });

  it('exports network config helpers', () => {
    expect(typeof resolveNetworkConfig).toBe('function');
    expect(typeof getDefaultSorobanRpcUrl).toBe('function');
    expect(typeof getDefaultHorizonUrl).toBe('function');
  });

  it('exports structured error classes', () => {
    expect(typeof Stellar_CardError).toBe('function');
    expect(typeof AuthError).toBe('function');
    expect(typeof RateLimitError).toBe('function');
    expect(typeof ServiceUnavailableError).toBe('function');
    expect(typeof SpendLimitError).toBe('function');
    expect(typeof OrderFailedError).toBe('function');
    expect(typeof WaitTimeoutError).toBe('function');
  });

  it('error classes extend Stellar_CardError', () => {
    expect(new AuthError()).toBeInstanceOf(Stellar_CardError);
    expect(new RateLimitError()).toBeInstanceOf(Stellar_CardError);
    expect(new SpendLimitError(100)).toBeInstanceOf(Stellar_CardError);
  });

  it('resolveNetworkConfig works correctly in browser context', () => {
    const cfg = resolveNetworkConfig();
    expect(cfg.sorobanRpc.url).toBe('https://mainnet.sorobanrpc.com');
    expect(cfg.horizon.url).toBe('https://horizon.stellar.org');
  });
});
