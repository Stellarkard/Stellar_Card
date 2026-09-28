import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateHeaderKey, validateHeaderValue, sanitizeHeaders, mergeHeaders } from '../network';
import { ValidationError } from '../errors';
import { Stellar_CardClient } from '../client';

describe('Custom HTTP Headers (#714)', () => {
  describe('Header Key and Value Validation', () => {
    it('accepts valid HTTP header keys', () => {
      expect(() => validateHeaderKey('X-Trace-ID')).not.toThrow();
      expect(() => validateHeaderKey('Authorization')).not.toThrow();
      expect(() => validateHeaderKey('User-Agent')).not.toThrow();
      expect(() => validateHeaderKey('gateway_token')).not.toThrow();
    });

    it('rejects empty or non-string header keys', () => {
      expect(() => validateHeaderKey('')).toThrow(ValidationError);
      expect(() => validateHeaderKey(null as unknown as string)).toThrow(ValidationError);
    });

    it('rejects header keys containing control characters or whitespace', () => {
      expect(() => validateHeaderKey('X-Bad\r\nKey')).toThrow(ValidationError);
      expect(() => validateHeaderKey('X-Bad Key')).toThrow(ValidationError);
      expect(() => validateHeaderKey('X-Bad\0Key')).toThrow(ValidationError);
      expect(() => validateHeaderKey('X-Bad\x1bKey')).toThrow(ValidationError);
    });

    it('accepts valid header values', () => {
      expect(() => validateHeaderValue('X-Trace-ID', 'trace-12345')).not.toThrow();
      expect(() => validateHeaderValue('User-Agent', 'MyAgent/1.0.0 (Linux)')).not.toThrow();
    });

    it('rejects header values with CRLF or control characters (CRLF injection prevention)', () => {
      expect(() => validateHeaderValue('X-Trace', 'trace\r\nInjected: true')).toThrow(
        ValidationError,
      );
      expect(() => validateHeaderValue('X-Trace', 'trace\nInjected: true')).toThrow(
        ValidationError,
      );
      expect(() => validateHeaderValue('X-Trace', 'trace\0null')).toThrow(ValidationError);
    });

    it('sanitizes and trims header keys in dictionary', () => {
      const sanitized = sanitizeHeaders({
        '  X-Trace-ID  ': 'trace-1',
        'X-Gateway-Token': 'gw-999',
      });
      expect(sanitized).toEqual({
        'X-Trace-ID': 'trace-1',
        'X-Gateway-Token': 'gw-999',
      });
    });

    it('returns empty object when no headers provided', () => {
      expect(sanitizeHeaders(undefined)).toEqual({});
    });
  });

  describe('Header Merging and Precedence', () => {
    it('merges custom client headers without overriding auth headers', () => {
      const baseAuth = {
        'X-Api-Key': 'real-api-key',
        'Content-Type': 'application/json',
      };
      const customClient = {
        'X-Trace-ID': 'trace-client-1',
        'X-Api-Key': 'malicious-override-key',
      };

      const merged = mergeHeaders(baseAuth, customClient);
      expect(merged['X-Trace-ID']).toBe('trace-client-1');
      // Auth header must NOT be overwritten by custom headers
      expect(merged['X-Api-Key']).toBe('real-api-key');
      expect(merged['Content-Type']).toBe('application/json');
    });

    it('allows per-request headers to override client-level custom headers', () => {
      const baseAuth = { 'X-Api-Key': 'real-api-key' };
      const customClient = {
        'X-Trace-ID': 'trace-client-1',
        'X-Custom-Env': 'production',
      };
      const perRequest = {
        'X-Trace-ID': 'trace-request-override',
      };

      const merged = mergeHeaders(baseAuth, customClient, perRequest);
      expect(merged['X-Trace-ID']).toBe('trace-request-override');
      expect(merged['X-Custom-Env']).toBe('production');
      expect(merged['X-Api-Key']).toBe('real-api-key');
    });

    it('prevents per-request headers from overriding base auth headers', () => {
      const baseAuth = { 'X-Api-Key': 'real-api-key' };
      const perRequest = { 'X-Api-Key': 'attempted-override' };

      const merged = mergeHeaders(baseAuth, {}, perRequest);
      expect(merged['X-Api-Key']).toBe('real-api-key');
    });
  });

  describe('Stellar_CardClient Custom Headers Integration', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          order_id: 'ord-123',
          status: 'pending_payment',
          payment: {
            type: 'soroban_contract',
            contract_id: 'C123',
            order_id: 'ord-123',
            usdc: { amount: '10.00', asset: 'USDC:G123' },
          },
          poll_url: 'https://api.stellar_card.com/v1/orders/ord-123',
          budget: {
            spent_usdc: '0',
            in_flight_usdc: '10',
            committed_usdc: '10',
            limit_usdc: '100',
            remaining_usdc: '90',
          },
        }),
      });
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    });

    it('passes client custom headers in outgoing requests', async () => {
      const client = new Stellar_CardClient({
        apiKey: 'test-api-key',
        headers: {
          'X-Trace-ID': 'agent-trace-001',
          'X-Agent-Gateway': 'gw-proxy-42',
        },
        disableVersionCheck: true,
      });

      await client.getOrder('ord-123');

      expect(fetchSpy).toHaveBeenCalled();
      const [, requestInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = requestInit.headers as Record<string, string>;

      expect(headers['X-Api-Key']).toBe('test-api-key');
      expect(headers['X-Trace-ID']).toBe('agent-trace-001');
      expect(headers['X-Agent-Gateway']).toBe('gw-proxy-42');
    });

    it('allows per-request header overrides in individual API calls', async () => {
      const client = new Stellar_CardClient({
        apiKey: 'test-api-key',
        headers: {
          'X-Trace-ID': 'default-client-trace',
        },
        disableVersionCheck: true,
      });

      await client.getOrder('ord-123', {
        headers: {
          'X-Trace-ID': 'specific-order-trace',
          'X-User-Context': 'user-999',
        },
      });

      expect(fetchSpy).toHaveBeenCalled();
      const [, requestInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = requestInit.headers as Record<string, string>;

      expect(headers['X-Api-Key']).toBe('test-api-key');
      expect(headers['X-Trace-ID']).toBe('specific-order-trace');
      expect(headers['X-User-Context']).toBe('user-999');
    });

    it('validates custom headers on client initialization', () => {
      expect(() => {
        new Stellar_CardClient({
          apiKey: 'test-api-key',
          headers: {
            'X-Bad\r\nHeader': 'value',
          },
          disableVersionCheck: true,
        });
      }).toThrow(ValidationError);
    });
  });
});
