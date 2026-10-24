import { describe, expect, it } from 'vitest';
import {
  detectNetworkFromPassphrase,
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
  MAINNET_HORIZON_URL,
  TESTNET_HORIZON_URL,
  MAINNET_SOROBAN_RPC_URL,
  TESTNET_SOROBAN_RPC_URL,
  MAINNET_USDC_SAC,
  TESTNET_USDC_SAC,
} from '../config';

describe('detectNetworkFromPassphrase', () => {
  it('detects Testnet from passphrase string', () => {
    const config = detectNetworkFromPassphrase(TESTNET_PASSPHRASE);
    expect(config.networkType).toBe('testnet');
    expect(config.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(config.horizonUrl).toBe(TESTNET_HORIZON_URL);
    expect(config.sorobanRpcUrl).toBe(TESTNET_SOROBAN_RPC_URL);
    expect(config.contractAddresses.usdcSac).toBe(TESTNET_USDC_SAC);
  });

  it('detects Mainnet from passphrase string', () => {
    const config = detectNetworkFromPassphrase(MAINNET_PASSPHRASE);
    expect(config.networkType).toBe('mainnet');
    expect(config.networkPassphrase).toBe(MAINNET_PASSPHRASE);
    expect(config.horizonUrl).toBe(MAINNET_HORIZON_URL);
    expect(config.sorobanRpcUrl).toBe(MAINNET_SOROBAN_RPC_URL);
    expect(config.contractAddresses.usdcSac).toBe(MAINNET_USDC_SAC);
  });

  it('allows manual URL and contract overrides for known networks', () => {
    const customHorizon = 'https://custom-testnet-horizon.stellar.org';
    const customRpc = 'https://custom-testnet-rpc.stellar.org';
    const customSac = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const config = detectNetworkFromPassphrase({
      networkPassphrase: TESTNET_PASSPHRASE,
      horizonUrl: customHorizon,
      sorobanRpcUrl: customRpc,
      contractAddresses: { usdcSac: customSac },
    });

    expect(config.networkType).toBe('testnet');
    expect(config.horizonUrl).toBe(customHorizon);
    expect(config.sorobanRpcUrl).toBe(customRpc);
    expect(config.contractAddresses.usdcSac).toBe(customSac);
  });

  it('supports custom standalone sandbox with explicit RPC configuration', () => {
    const customPassphrase = 'Standalone Sandbox Network ; January 2026';
    const customRpc = 'http://localhost:8000/soroban/rpc';
    const customHorizon = 'http://localhost:8000';

    const config = detectNetworkFromPassphrase({
      networkPassphrase: customPassphrase,
      sorobanRpcUrl: customRpc,
      horizonUrl: customHorizon,
    });

    expect(config.networkType).toBe('custom');
    expect(config.networkPassphrase).toBe(customPassphrase);
    expect(config.sorobanRpcUrl).toBe(customRpc);
    expect(config.horizonUrl).toBe(customHorizon);
  });

  it('throws descriptive error if unrecognized passphrase is provided without custom RPC configuration', () => {
    const unknownPassphrase = 'Unknown Private Network ; 2026';
    expect(() => {
      detectNetworkFromPassphrase(unknownPassphrase);
    }).toThrowError(/Unrecognized network passphrase.*must explicitly provide/);
  });

  it('throws error when empty passphrase is provided', () => {
    expect(() => {
      detectNetworkFromPassphrase('');
    }).toThrowError(/A Stellar network passphrase is required/);
  });
});
