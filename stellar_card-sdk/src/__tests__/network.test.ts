import { describe, it, expect, afterEach } from 'vitest';
import { Networks } from '@stellar/stellar-sdk';
import {
  resolveNetworkConfig,
  resolveNetworkConfigFromEnv,
  getDefaultSorobanRpcUrl,
  getDefaultHorizonUrl,
  NETWORK_ENV_VARS,
  validateRpcEndpoint,
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
});

describe('getDefaultSorobanRpcUrl', () => {
  it('returns mainnet RPC for PUBLIC passphrase', () => {
    expect(getDefaultSorobanRpcUrl(Networks.PUBLIC)).toBe('https://mainnet.sorobanrpc.com');
  });

  it('returns testnet RPC for TESTNET passphrase', () => {
    expect(getDefaultSorobanRpcUrl(Networks.TESTNET)).toBe(
      'https://soroban-testnet.stellar.org',
    );
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
