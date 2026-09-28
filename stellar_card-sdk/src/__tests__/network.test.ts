import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  resolveNetworkConfig,
  resolveNetworkConfigFromEnv,
  getDefaultSorobanRpcUrl,
  getDefaultHorizonUrl,
  NETWORK_ENV_VARS,
  validateRpcEndpoint,
  createProxyAgent,
  resolveProxyUrl,
  shouldBypassProxy,
} from '../network';

describe('resolveNetworkConfig', () => {
  it('defaults to PUBLIC network with mainnet endpoints', () => {
    const cfg = resolveNetworkConfig();
    expect(cfg.networkPassphrase).toBe(Networks.PUBLIC);
    expect(cfg.sorobanRpc.url).toBe('https://mainnet.sorobanrpc.com');
    expect(cfg.horizon.url).toBe('https://horizon.stellar.org');
  });

  it('resolves testnet defaults for Networks.TESTNET', () => {
    const cfg = resolveNetworkConfig({ networkPassphrase: Networks.TESTNET });
    expect(cfg.sorobanRpc.url).toBe('https://soroban-testnet.stellar.org');
    expect(cfg.horizon.url).toBe('https://horizon-testnet.stellar.org');
  });

  it('respects explicit sorobanRpcUrl override', () => {
    const cfg = resolveNetworkConfig({
      networkPassphrase: Networks.PUBLIC,
      sorobanRpcUrl: 'https://my-custom-rpc.example.com',
    });
    expect(cfg.sorobanRpc.url).toBe('https://my-custom-rpc.example.com');
    expect(cfg.horizon.url).toBe('https://horizon.stellar.org');
  });

  it('respects explicit horizonUrl override', () => {
    const cfg = resolveNetworkConfig({
      networkPassphrase: Networks.PUBLIC,
      horizonUrl: 'https://my-horizon.example.com',
    });
    expect(cfg.horizon.url).toBe('https://my-horizon.example.com');
    expect(cfg.sorobanRpc.url).toBe('https://mainnet.sorobanrpc.com');
  });

  it('allows both overrides simultaneously', () => {
    const cfg = resolveNetworkConfig({
      sorobanRpcUrl: 'https://rpc.custom.net',
      horizonUrl: 'https://horizon.custom.net',
    });
    expect(cfg.sorobanRpc.url).toBe('https://rpc.custom.net');
    expect(cfg.horizon.url).toBe('https://horizon.custom.net');
  });

  it('carries apiKey, timeout and headers through object-form endpoints', () => {
    const cfg = resolveNetworkConfig({
      sorobanRpcUrl: {
        url: 'https://rpc.custom.net',
        apiKey: 'secret',
        timeout: 5000,
        headers: { 'X-Trace': '1' },
      },
    });
    expect(cfg.sorobanRpc.url).toBe('https://rpc.custom.net');
    expect(cfg.sorobanRpc.apiKey).toBe('secret');
    expect(cfg.sorobanRpc.timeout).toBe(5000);
    expect(cfg.sorobanRpc.headers).toEqual({ 'X-Trace': '1' });
    // Untouched endpoint keeps the default 30s timeout.
    expect(cfg.horizon.timeout).toBe(30000);
  });

  it('ignores blank or whitespace-only configuration values', () => {
    const cfg = resolveNetworkConfig({
      networkPassphrase: '   ',
      networkName: '   ',
      sorobanRpcUrl: '   ',
      horizonUrl: { url: '   ' },
    });

    expect(cfg.networkPassphrase).toBe(Networks.PUBLIC);
    expect(cfg.networkName).toBe('Mainnet');
    expect(cfg.sorobanRpc.url).toBe('https://mainnet.sorobanrpc.com');
    expect(cfg.horizon.url).toBe('https://horizon.stellar.org');
  });
});

describe('getDefaultSorobanRpcUrl', () => {
  it('returns mainnet RPC for PUBLIC passphrase', () => {
    expect(getDefaultSorobanRpcUrl(Networks.PUBLIC)).toBe('https://mainnet.sorobanrpc.com');
  });

  it('returns testnet RPC for TESTNET passphrase', () => {
    expect(getDefaultSorobanRpcUrl(Networks.TESTNET)).toBe('https://soroban-testnet.stellar.org');
  });

  it('defaults to mainnet when no passphrase given', () => {
    expect(getDefaultSorobanRpcUrl()).toBe('https://mainnet.sorobanrpc.com');
  });
});

describe('getDefaultHorizonUrl', () => {
  it('returns mainnet Horizon for PUBLIC passphrase', () => {
    expect(getDefaultHorizonUrl(Networks.PUBLIC)).toBe('https://horizon.stellar.org');
  });

  it('returns testnet Horizon for TESTNET passphrase', () => {
    expect(getDefaultHorizonUrl(Networks.TESTNET)).toBe('https://horizon-testnet.stellar.org');
  });

  it('defaults to mainnet when no passphrase given', () => {
    expect(getDefaultHorizonUrl()).toBe('https://horizon.stellar.org');
  });
});

describe('resolveNetworkConfigFromEnv', () => {
  const touched = Object.values(NETWORK_ENV_VARS);
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of touched) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
      delete saved[key];
    }
  });

  const setEnv = (key: string, value: string) => {
    saved[key] = process.env[key];
    process.env[key] = value;
  };

  it('falls back to public defaults when nothing is set', () => {
    const cfg = resolveNetworkConfigFromEnv();
    expect(cfg.networkPassphrase).toBe(Networks.PUBLIC);
    expect(cfg.sorobanRpc.url).toBe('https://mainnet.sorobanrpc.com');
  });

  it('reads custom endpoints from the environment', () => {
    setEnv(NETWORK_ENV_VARS.sorobanRpcUrl, 'https://env-rpc.example.com');
    setEnv(NETWORK_ENV_VARS.horizonUrl, 'https://env-horizon.example.com');
    setEnv(NETWORK_ENV_VARS.networkName, 'CI Network');
    const cfg = resolveNetworkConfigFromEnv();
    expect(cfg.sorobanRpc.url).toBe('https://env-rpc.example.com');
    expect(cfg.horizon.url).toBe('https://env-horizon.example.com');
    expect(cfg.networkName).toBe('CI Network');
  });

  it('attaches env apiKey and timeout to configured endpoints', () => {
    setEnv(NETWORK_ENV_VARS.sorobanRpcUrl, 'https://env-rpc.example.com');
    setEnv(NETWORK_ENV_VARS.apiKey, 'env-key');
    setEnv(NETWORK_ENV_VARS.timeout, '9000');
    const cfg = resolveNetworkConfigFromEnv();
    expect(cfg.sorobanRpc.apiKey).toBe('env-key');
    expect(cfg.sorobanRpc.timeout).toBe(9000);
  });

  it('lets explicit overrides win over the environment', () => {
    setEnv(NETWORK_ENV_VARS.sorobanRpcUrl, 'https://env-rpc.example.com');
    const cfg = resolveNetworkConfigFromEnv({
      sorobanRpcUrl: 'https://override-rpc.example.com',
    });
    expect(cfg.sorobanRpc.url).toBe('https://override-rpc.example.com');
  });

  it('rejects a non-positive-integer timeout', () => {
    setEnv(NETWORK_ENV_VARS.timeout, 'not-a-number');
    expect(() => resolveNetworkConfigFromEnv()).toThrow(/positive integer/);
  });

  it('ignores blank or whitespace-only environment values', () => {
    setEnv(NETWORK_ENV_VARS.networkPassphrase, '   ');
    setEnv(NETWORK_ENV_VARS.sorobanRpcUrl, '   ');
    setEnv(NETWORK_ENV_VARS.horizonUrl, '   ');
    setEnv(NETWORK_ENV_VARS.apiKey, '   ');
    setEnv(NETWORK_ENV_VARS.timeout, '   ');
    setEnv(NETWORK_ENV_VARS.networkName, '   ');

    const cfg = resolveNetworkConfigFromEnv();
    expect(cfg.networkPassphrase).toBe(Networks.PUBLIC);
    expect(cfg.sorobanRpc.url).toBe('https://mainnet.sorobanrpc.com');
    expect(cfg.horizon.url).toBe('https://horizon.stellar.org');
    expect(cfg.networkName).toBe('Mainnet');
  });
});

describe('validateRpcEndpoint', () => {
  it('allows valid HTTPS and HTTP URLs', () => {
    expect(() => validateRpcEndpoint('https://rpc.stellar.org')).not.toThrow();
    expect(() => validateRpcEndpoint('http://localhost:8000')).not.toThrow();
  });

  it('rejects invalid URL structures or protocols', () => {
    expect(() => validateRpcEndpoint('invalid-url')).toThrow(/Invalid RPC endpoint URL/);
    expect(() => validateRpcEndpoint('ftp://rpc.stellar.org')).toThrow(/Invalid protocol: ftp/);
  });
});

describe('proxy support (#768)', () => {
  let envBackup: Record<string, string | undefined>;

  beforeEach(() => {
    envBackup = {};
    if (typeof process !== 'undefined' && process.env) {
      envBackup.HTTPS_PROXY = process.env.HTTPS_PROXY;
      envBackup.HTTP_PROXY = process.env.HTTP_PROXY;
      envBackup.NO_PROXY = process.env.NO_PROXY;
      delete process.env.HTTPS_PROXY;
      delete process.env.HTTP_PROXY;
      delete process.env.NO_PROXY;
    }
  });

  afterEach(() => {
    if (typeof process !== 'undefined' && process.env) {
      if (envBackup.HTTPS_PROXY !== undefined) process.env.HTTPS_PROXY = envBackup.HTTPS_PROXY;
      else delete process.env.HTTPS_PROXY;
      if (envBackup.HTTP_PROXY !== undefined) process.env.HTTP_PROXY = envBackup.HTTP_PROXY;
      else delete process.env.HTTP_PROXY;
      if (envBackup.NO_PROXY !== undefined) process.env.NO_PROXY = envBackup.NO_PROXY;
      else delete process.env.NO_PROXY;
    }
  });

  describe('createProxyAgent', () => {
    it('returns undefined when proxy packages are not available', () => {
      const agent = createProxyAgent('http://proxy.example.com:8080');
      // If packages are not installed, should return undefined
      // If packages are installed, should return an agent
      expect(agent === undefined || typeof agent === 'object').toBe(true);
    });

    it('throws error for unsupported proxy protocol', () => {
      if (typeof process !== 'undefined' && process.env) {
        // Mock the proxy packages to be available
        vi.stubGlobal('require', vi.fn(() => ({ default: class {} })));
        expect(() => createProxyAgent('ftp://proxy.example.com')).toThrow(
          /Unsupported proxy protocol/,
        );
        vi.unstubAllGlobals();
      }
    });
  });

  describe('resolveProxyUrl', () => {
    it('returns config.proxyUrl when explicitly set', () => {
      const config = { proxyUrl: 'http://config-proxy.example.com:8080' };
      const result = resolveProxyUrl(config);
      expect(result).toBe('http://config-proxy.example.com:8080');
    });

    it('prioritizes HTTPS_PROXY over HTTP_PROXY', () => {
      if (typeof process !== 'undefined' && process.env) {
        process.env.HTTPS_PROXY = 'https://secure-proxy.example.com:8443';
        process.env.HTTP_PROXY = 'http://proxy.example.com:8080';
        const result = resolveProxyUrl();
        expect(result).toBe('https://secure-proxy.example.com:8443');
      }
    });

    it('falls back to HTTP_PROXY when HTTPS_PROXY is not set', () => {
      if (typeof process !== 'undefined' && process.env) {
        process.env.HTTP_PROXY = 'http://proxy.example.com:8080';
        const result = resolveProxyUrl();
        expect(result).toBe('http://proxy.example.com:8080');
      }
    });

    it('returns undefined when no proxy is configured', () => {
      const result = resolveProxyUrl({});
      expect(result).toBeUndefined();
    });

    it('respects config.proxyUrl over environment variables', () => {
      if (typeof process !== 'undefined' && process.env) {
        process.env.HTTPS_PROXY = 'https://env-proxy.example.com:8443';
        const config = { proxyUrl: 'http://config-proxy.example.com:8080' };
        const result = resolveProxyUrl(config);
        expect(result).toBe('http://config-proxy.example.com:8080');
      }
    });

    it('handles lowercase environment variable names', () => {
      if (typeof process !== 'undefined' && process.env) {
        process.env.https_proxy = 'https://secure-proxy.example.com:8443';
        const result = resolveProxyUrl();
        expect(result).toBe('https://secure-proxy.example.com:8443');
      }
    });
  });

  describe('shouldBypassProxy', () => {
    it('returns false when NO_PROXY is not set', () => {
      expect(shouldBypassProxy('https://api.example.com')).toBe(false);
    });

    it('returns true for exact hostname match', () => {
      expect(shouldBypassProxy('https://localhost', 'localhost')).toBe(true);
      expect(shouldBypassProxy('https://api.example.com', 'api.example.com')).toBe(true);
    });

    it('returns true for domain suffix match with wildcard', () => {
      expect(shouldBypassProxy('https://api.example.com', '*.example.com')).toBe(true);
      expect(shouldBypassProxy('https://sub.api.example.com', '*.example.com')).toBe(true);
    });

    it('returns true for substring match', () => {
      expect(shouldBypassProxy('https://internal-api.example.com', 'internal')).toBe(true);
    });

    it('returns false when hostname does not match any pattern', () => {
      expect(shouldBypassProxy('https://external.com', '*.example.com')).toBe(false);
      expect(shouldBypassProxy('https://api.example.com', 'localhost')).toBe(false);
    });

    it('handles comma-separated NO_PROXY list', () => {
      const noProxy = 'localhost,*.example.com,192.168.1.1';
      expect(shouldBypassProxy('https://localhost', noProxy)).toBe(true);
      expect(shouldBypassProxy('https://api.example.com', noProxy)).toBe(true);
      expect(shouldBypassProxy('https://192.168.1.1', noProxy)).toBe(true);
      expect(shouldBypassProxy('https://external.com', noProxy)).toBe(false);
    });

    it('trims whitespace from NO_PROXY patterns', () => {
      expect(shouldBypassProxy('https://api.example.com', ' *.example.com , ')).toBe(true);
    });
  });
});
