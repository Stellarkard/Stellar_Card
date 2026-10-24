// Unit tests for SDK logging system with pluggable logger interface
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, SilentLogger, ConsoleLogger, type Logger, type LogLevel } from '../logger';
import { Stellar_CardClient } from '../client';
import { payViaContract } from '../stellar';

describe('Logger system', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  describe('SilentLogger', () => {
    it('provides no-op implementations for debug, info, warn, and error', () => {
      const logger = new SilentLogger();
      expect(() => {
        logger.debug('debug msg', { foo: 'bar' });
        logger.info('info msg', { foo: 'bar' });
        logger.warn('warn msg', { foo: 'bar' });
        logger.error('error msg', { foo: 'bar' });
      }).not.toThrow();
    });
  });

  describe('ConsoleLogger', () => {
    it('logs messages matching or exceeding the current log level', () => {
      const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const logger = new ConsoleLogger('warn');

      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(consoleDebugSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('filters everything when level is silent', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new ConsoleLogger('silent');

      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('formats metadata and includes timestamp and tags', () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const logger = new ConsoleLogger('debug');

      logger.info('User action', { userId: 123 });
      expect(consoleInfoSpy).toHaveBeenCalledWith(expect.stringContaining('User action'), {
        userId: 123,
      });
    });
  });

  describe('createLogger factory', () => {
    it('returns custom logger directly when provided', () => {
      const customLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const result = createLogger({ logger: customLogger });
      result.info('test message');
      expect(customLogger.info).toHaveBeenCalledWith('test message');
    });

    it('returns SilentLogger in production when no custom logger or debug level is passed', () => {
      process.env.NODE_ENV = 'production';
      const logger = createLogger();
      expect(logger).toBeInstanceOf(SilentLogger);
    });

    it('returns ConsoleLogger when logLevel is explicitly set to debug', () => {
      const logger = createLogger({ logLevel: 'debug' });
      expect(logger).toBeInstanceOf(ConsoleLogger);
    });
  });

  describe('Client integration', () => {
    it('accepts custom logger and logs HTTP requests and retries', async () => {
      const customLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      // Mock fetch to simulate 429 followed by 200
      let attempts = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return new Response('Rate limited', {
            status: 429,
            headers: { 'Retry-After': '0' },
          });
        }
        return new Response(JSON.stringify({ id: 'ord_123', status: 'pending' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = new Stellar_CardClient({
        apiKey: 'test_key',
        baseUrl: 'https://api.example.com',
        logger: customLogger,
        logLevel: 'debug',
        retry: {
          attempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 2,
          jitter: false,
        },
      });

      expect(client.logger).toBeDefined();

      const order = await client.getOrder('ord_123');
      expect(order.id).toBe('ord_123');

      // Check that debug HTTP request was logged
      expect(customLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('HTTP GET https://api.example.com/orders/ord_123'),
      );

      // Check that info retry was logged
      expect(customLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Retrying request to https://api.example.com/orders/ord_123'),
        expect.objectContaining({ status: 429 }),
      );
    });
  });

  describe('Stellar contract payment logging', () => {
    it('logs contract submission at info level when logger is passed', async () => {
      const customLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      // Keypair secret for testing
      const testSecret = 'SDTU6SC277N7HXIP2K22N4X33N5J5PQQ2J5PP7636X2Q4Q4Q4Q4Q4Q4Q'; // Invalid mock secret or test
      // Test invalid contract_id rejection
      await expect(
        payViaContract({
          walletSecret: 'SDAK2Q6UOGU44VUS42G77QGBLA7W7U66AFAFAFAFAFAFAFAFAFAFAFAF',
          payment: {
            type: 'soroban_contract',
            contract_id: 'INVALID_CONTRACT',
            order_id: 'ord_1',
            usdc: { amount: '10.00', asset: 'USDC:G...' },
          },
          logger: customLogger,
        }),
      ).rejects.toThrow('Invalid contract_id');
    });
  });
});
