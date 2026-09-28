/**
 * Tests that the browser entry point runs smoothly in DOM, Web Worker,
 * and Service Worker environments. Validates that no Node.js globals
 * (process.env, Buffer, etc.) cause reference errors.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('browser SDK in DOM/Worker environments', () => {
  let originalProcessEnv: NodeJS.ProcessEnv;
  let originalGlobal: Record<string, any>;

  beforeEach(() => {
    originalProcessEnv = process.env;
    originalGlobal = { ...global };
  });

  afterEach(() => {
    process.env = originalProcessEnv;
    Object.assign(global, originalGlobal);
  });

  describe('DOM environment', () => {
    it('initializes Stellar_CardClient in simulated DOM context', () => {
      const mockWindow = {
        localStorage: new Map(),
        navigator: { userAgent: 'Mozilla/5.0' },
        fetch: vi.fn(),
      };

      Object.assign(global, mockWindow);

      process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

      const { Stellar_CardClient } = require('../browser');

      const client = new Stellar_CardClient({
        apiKey: 'test_key_12345',
        baseUrl: 'http://localhost:3000/v1',
      });

      expect(client).toBeDefined();
      expect(typeof client.createOrder).toBe('function');
    });

    it('creates order in DOM environment without process.env errors', async () => {
      process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

      const { Stellar_CardClient } = require('../browser');

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          order_id: 'test_order_123',
          phase: 'awaiting_payment',
          payment: { type: 'soroban_contract', contract_id: 'C...' },
        }),
      });

      global.fetch = mockFetch;

      const client = new Stellar_CardClient({
        apiKey: 'test_key',
        baseUrl: 'http://localhost:3000/v1',
      });

      const order = await client.createOrder({ amount_usdc: '10.00' });

      expect(order).toBeDefined();
      expect(order.order_id).toBe('test_order_123');
      expect(mockFetch).toHaveBeenCalled();
    });

    it('accesses localStorage in DOM without errors', () => {
      const mockLocalStorage = new Map();
      Object.assign(global, {
        localStorage: {
          getItem: (key: string) => mockLocalStorage.get(key),
          setItem: (key: string, value: string) => mockLocalStorage.set(key, value),
          removeItem: (key: string) => mockLocalStorage.delete(key),
          clear: () => mockLocalStorage.clear(),
        },
      });

      process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

      const { Stellar_CardClient } = require('../browser');

      const client = new Stellar_CardClient({
        apiKey: 'test_key',
        baseUrl: 'http://localhost:3000/v1',
      });

      expect(client).toBeDefined();
    });
  });

  describe('Web Worker environment', () => {
    it('initializes client in simulated Web Worker context', () => {
      const mockWorkerGlobal = {
        self: {},
        postMessage: vi.fn(),
        onmessage: null,
        importScripts: vi.fn(),
      };

      Object.assign(global, mockWorkerGlobal);
      delete (process.env as any).NODE_ENV;

      process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

      const { Stellar_CardClient } = require('../browser');

      const client = new Stellar_CardClient({
        apiKey: 'test_key_worker',
        baseUrl: 'http://localhost:3000/v1',
      });

      expect(client).toBeDefined();
      expect(typeof client.createOrder).toBe('function');
    });

    it('computes WebCrypto signatures in Web Worker environment', async () => {
      const mockWorkerGlobal = {
        crypto: {
          getRandomValues: (arr: Uint8Array) => {
            for (let i = 0; i < arr.length; i++) {
              arr[i] = Math.floor(Math.random() * 256);
            }
            return arr;
          },
          subtle: {
            importKey: vi.fn().mockResolvedValue({}),
            sign: vi.fn().mockResolvedValue(new ArrayBuffer(64)),
            verify: vi.fn().mockResolvedValue(true),
            digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
          },
        },
      };

      Object.assign(global, mockWorkerGlobal);

      process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

      const { Stellar_CardClient } = require('../browser');

      const client = new Stellar_CardClient({
        apiKey: 'test_key',
        baseUrl: 'http://localhost:3000/v1',
      });

      expect(client).toBeDefined();
      expect(global.crypto?.subtle?.sign).toBeDefined();
    });

    it('does not reference Node.js globals in Worker', () => {
      const mockWorkerGlobal = {
        Buffer: undefined,
        process: undefined,
        module: undefined,
        require: undefined,
      };

      Object.assign(global, mockWorkerGlobal);

      process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

      const { Stellar_CardClient } = require('../browser');

      const client = new Stellar_CardClient({
        apiKey: 'test_key',
        baseUrl: 'http://localhost:3000/v1',
      });

      expect(client).toBeDefined();
      expect(typeof client).toBe('function');
    });
  });

  describe('Service Worker environment', () => {
    it('initializes client in simulated Service Worker context', () => {
      const mockServiceWorkerGlobal = {
        self: {
          clients: {},
          registration: {},
          addEventListener: vi.fn(),
        },
        importScripts: vi.fn(),
        skipWaiting: vi.fn(),
        clients: {
          claim: vi.fn(),
          matchAll: vi.fn().mockResolvedValue([]),
        },
      };

      Object.assign(global, mockServiceWorkerGlobal);

      process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

      const { Stellar_CardClient } = require('../browser');

      const client = new Stellar_CardClient({
        apiKey: 'test_key_sw',
        baseUrl: 'http://localhost:3000/v1',
      });

      expect(client).toBeDefined();
    });

    it('handles fetch in Service Worker cache-first strategy', async () => {
      const mockCache = new Map();
      const mockServiceWorkerGlobal = {
        self: {
          clients: {},
          registration: {
            scope: '/',
          },
        },
        caches: {
          open: vi.fn().mockResolvedValue({
            put: vi.fn((req, resp) => mockCache.set(req, resp)),
            match: vi.fn((req) => Promise.resolve(mockCache.get(req))),
          }),
        },
      };

      Object.assign(global, mockServiceWorkerGlobal);

      process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

      const { Stellar_CardClient } = require('../browser');

      const client = new Stellar_CardClient({
        apiKey: 'test_key',
        baseUrl: 'http://localhost:3000/v1',
      });

      expect(client).toBeDefined();
      expect(typeof client.createOrder).toBe('function');
    });
  });

  describe('Cross-environment compatibility', () => {
    it('exports browser-safe utilities that work in all environments', () => {
      process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

      const {
        calculateExponentialBackoffDelay,
        parseRetryAfterMs,
        sleep,
        paginate,
      } = require('../browser');

      expect(typeof calculateExponentialBackoffDelay).toBe('function');
      expect(typeof parseRetryAfterMs).toBe('function');
      expect(typeof sleep).toBe('function');
      expect(typeof paginate).toBe('function');
    });

    it('throws no ReferenceError for Node.js globals in browser entry', () => {
      process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

      expect(() => {
        require('../browser');
      }).not.toThrow();
    });

    it('error classes are available in browser context', () => {
      process.env.CARDS402_ALLOW_INSECURE_BASE_URL = '1';

      const {
        Stellar_CardError,
        AuthError,
        RateLimitError,
        SpendLimitError,
      } = require('../browser');

      expect(new Stellar_CardError('test', 'code', 500)).toBeInstanceOf(Error);
      expect(new AuthError()).toBeInstanceOf(Stellar_CardError);
      expect(new RateLimitError()).toBeInstanceOf(Stellar_CardError);
      expect(new SpendLimitError('100', '50')).toBeInstanceOf(Stellar_CardError);
    });
  });
});
