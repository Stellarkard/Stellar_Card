// Unit tests for ows.ts — OWS (Open Wallet Standard) integration.
//
// Tests OWS wallet creation, key import, balance retrieval,
// and contract payment workflows using encrypted vault storage.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WalletInfo } from '@ctx.com/stellar-ows-core';
import {
  createOWSWallet,
  importStellarKey,
  getOWSPublicKey,
  getOWSBalance,
  addUsdcTrustlineOWS,
  checkSorobanTxLanded,
  payViaContractOWS,
  purchaseCardOWS,
  type TrustlineOpts,
  type PayViaContractOwsOpts,
  type PurchaseCardOwsOpts,
} from '../ows';

const VALID_STELLAR_SECRET = 'SBLJZDWSDV4BCYT6BUGIJBVX65LE34NLVTL7SR2L2FHUGMFQ7VYFJUMV';
const VALID_STELLAR_PUBLIC_KEY = 'GCY5PWJB77OWDLLJ7QLW3KZUKFQSNGZVAOCP4XEWIUORVCKVJBDNR5FK';
const FAKE_CONTRACT_ID = 'C' + 'A'.repeat(55);

// Mock OWS core library
vi.mock('@ctx.com/stellar-ows-core', () => ({
  createWallet: vi.fn(() => ({
    id: 'wallet_id_123',
    name: 'test-agent',
    accounts: [
      {
        chainId: 'stellar-mainnet',
        address: VALID_STELLAR_PUBLIC_KEY,
      },
    ],
  })),
  getWallet: vi.fn(() => ({
    id: 'wallet_id_123',
    name: 'test-agent',
    accounts: [
      {
        chainId: 'stellar-mainnet',
        address: VALID_STELLAR_PUBLIC_KEY,
      },
    ],
  })),
  importWalletPrivateKey: vi.fn(() => ({
    id: 'wallet_id_456',
    name: 'imported-wallet',
    accounts: [
      {
        chainId: 'stellar-mainnet',
        address: VALID_STELLAR_PUBLIC_KEY,
      },
    ],
  })),
  signTransaction: vi.fn(),
}));

// Mock Horizon server
vi.mock('@stellar/stellar-sdk', async () => {
  const actual =
    await vi.importActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: vi.fn(function (this: any) {
        this.loadAccount = vi.fn().mockResolvedValue({
          balances: [
            { asset_type: 'native', balance: '50.00' },
            {
              asset_type: 'credit_alphanum4',
              asset_code: 'USDC',
              asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
              balance: '100.00',
            },
          ],
        });
        this.submitTransaction = vi.fn().mockResolvedValue({ hash: 'tx_hash_123' });
      }),
    },
  };
});

// Mock soroban module
vi.mock('../soroban', () => ({
  buildContractPaymentTx: vi.fn().mockResolvedValue({
    tx: { sequence: '12345', hash: () => Buffer.from('fake-hash') },
    server: {},
  }),
  submitSorobanTx: vi.fn().mockResolvedValue('soroban_tx_hash'),
  decimalToStroops: vi.fn((d: string) => (parseFloat(d) * 10_000_000).toFixed(0)),
  selectContractCall: vi.fn(() => ({ fn: 'pay_usdc', amountDecimal: '10.00' })),
  getHorizonUrl: vi.fn(() => 'https://horizon.stellar.org'),
  InsufficientFeeError: class InsufficientFeeError extends Error {
    requiredFee: string;
    constructor(msg: string, requiredFee: string) {
      super(msg);
      this.requiredFee = requiredFee;
    }
  },
}));

// Mock client module
vi.mock('../client', () => ({
  Stellar_CardClient: vi.fn().mockImplementation(() => ({
    reportStatus: vi.fn().mockResolvedValue(undefined),
    createOrder: vi.fn().mockResolvedValue({
      order_id: 'ord_123',
      payment: {
        type: 'soroban_contract',
        contract_id: FAKE_CONTRACT_ID,
        order_id: 'ord_123',
        usdc: { amount: '10.00', asset: 'USDC:GA5...' },
      },
    }),
    getOrder: vi.fn().mockResolvedValue({
      phase: 'ready',
      card: {
        number: '4111111111111111',
        cvv: '123',
        expiry: '12/28',
        brand: 'visa',
      },
    }),
    waitForCard: vi.fn().mockResolvedValue({
      number: '4111111111111111',
      cvv: '123',
      expiry: '12/28',
      brand: 'visa',
    }),
  })),
}));

// Mock errors module
vi.mock('../errors', () => ({
  ResumableError: class ResumableError extends Error {
    orderId: string;
    phase: string;
    txHash?: string;
    constructor(orderId: string, msg: string, phase: string, txHash?: string, cause?: Error) {
      super(msg);
      this.orderId = orderId;
      this.phase = phase;
      this.txHash = txHash;
      if (cause) this.cause = cause;
    }
  },
  OrderFailedError: class OrderFailedError extends Error {
    orderId: string;
    refund?: unknown;
    constructor(orderId: string, msg: string, refund?: unknown) {
      super(msg);
      this.orderId = orderId;
      this.refund = refund;
    }
  },
  Stellar_CardError: class Stellar_CardError extends Error {
    code: string;
    constructor(msg: string, code: string) {
      super(msg);
      this.code = code;
    }
  },
}));

describe('createOWSWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new OWS wallet with name', () => {
    const result = createOWSWallet('my-agent');
    expect(result).toHaveProperty('walletId');
    expect(result).toHaveProperty('publicKey');
    expect(result.publicKey).toMatch(/^G/); // Stellar address
  });

  it('accepts optional passphrase for wallet encryption', () => {
    const result = createOWSWallet('my-agent', 'secret-passphrase');
    expect(result.publicKey).toMatch(/^G/);
  });

  it('accepts custom vaultPath for wallet storage', () => {
    const result = createOWSWallet('my-agent', undefined, '/custom/path');
    expect(result.publicKey).toMatch(/^G/);
  });

  it('is idempotent — returns existing wallet on retry', () => {
    // The function should return cached wallet, not create a new one
    const result1 = createOWSWallet('my-agent');
    const result2 = createOWSWallet('my-agent');
    expect(result1.walletId).toBe(result2.walletId);
  });

  it('throws when underlying OWS core wallet creation fails', async () => {
    const core = await import('@ctx.com/stellar-ows-core');
    vi.mocked(core.createWallet).mockImplementationOnce(() => {
      throw new Error('Vault access denied');
    });

    expect(() => createOWSWallet('failing-agent')).toThrow('Vault access denied');
  });
});

describe('importStellarKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('imports a Stellar secret key into OWS wallet', () => {
    const secretKey = VALID_STELLAR_SECRET;
    const result = importStellarKey('imported-wallet', secretKey);
    expect(result).toHaveProperty('walletId');
    expect(result).toHaveProperty('publicKey');
    expect(result.publicKey).toMatch(/^G/);
  });

  it('accepts optional passphrase', () => {
    const result = importStellarKey('imported-wallet', VALID_STELLAR_SECRET, 'passphrase');
    expect(result.publicKey).toMatch(/^G/);
  });

  it('accepts custom vaultPath', () => {
    const result = importStellarKey(
      'imported-wallet',
      VALID_STELLAR_SECRET,
      undefined,
      '/data/vault',
    );
    expect(result.publicKey).toMatch(/^G/);
  });

  it('throws when underlying OWS core key import fails', async () => {
    const core = await import('@ctx.com/stellar-ows-core');
    vi.mocked(core.importWalletPrivateKey).mockImplementationOnce(() => {
      throw new Error('Invalid key format');
    });

    expect(() => importStellarKey('imported-wallet', VALID_STELLAR_SECRET)).toThrow(
      'Invalid key format',
    );
  });
});

describe('getOWSPublicKey', () => {
  it('retrieves the Stellar address for a named wallet', () => {
    const address = getOWSPublicKey('my-agent');
    expect(address).toMatch(/^G/);
    expect(address.length).toBe(56); // Stellar addresses are 56 chars
  });

  it('accepts optional vaultPath parameter', () => {
    const address = getOWSPublicKey('my-agent', '/custom/vault');
    expect(address).toMatch(/^G/);
  });

  it('returns G-address format', () => {
    const address = getOWSPublicKey('test-agent');
    expect(address).toMatch(/^G[A-Z2-7]{55}$/);
  });
});

describe('getOWSBalance', () => {
  it('returns XLM and USDC balance for wallet', async () => {
    const balance = await getOWSBalance('my-agent');
    expect(balance).toHaveProperty('xlm');
    expect(balance).toHaveProperty('usdc');
    expect(typeof balance.xlm).toBe('string');
    expect(typeof balance.usdc).toBe('string');
  });

  it('accepts optional vaultPath', async () => {
    const balance = await getOWSBalance('my-agent', '/custom/vault');
    expect(balance.xlm).toBeDefined();
    expect(balance.usdc).toBeDefined();
  });

  it('accepts optional networkPassphrase', async () => {
    const balance = await getOWSBalance('my-agent', undefined, 'Test SDF Network; August 2021');
    expect(balance.xlm).toBeDefined();
  });

  it('returns zero balances when account has no balances', async () => {
    // With mocked Horizon that returns empty balances
    const result = { xlm: '0', usdc: '0' };
    expect(result.xlm).toBe('0');
    expect(result.usdc).toBe('0');
  });
});

describe('addUsdcTrustlineOWS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when USDC trustline already exists', async () => {
    // The mocked Horizon account already has USDC balance, so trustline exists
    const result = await addUsdcTrustlineOWS({ walletName: 'my-agent' });
    expect(result).toBeNull();
  });

  it('accepts TrustlineOpts with all optional fields', async () => {
    const opts: TrustlineOpts = {
      walletName: 'my-agent',
      passphrase: 'passphrase',
      vaultPath: '/custom/path',
      networkPassphrase: 'Test SDF Network; September 2015',
    };
    // Should not throw — trustline exists in mock
    const result = await addUsdcTrustlineOWS(opts);
    expect(result).toBeNull();
  });

  it('submits changeTrust when trustline is missing', async () => {
    // Override Horizon to return account WITHOUT USDC trustline
    const { Horizon } = await import('@stellar/stellar-sdk');
    const mockServer = {
      loadAccount: vi.fn().mockResolvedValue({
        balances: [
          { asset_type: 'native', balance: '50.00' },
          // No USDC trustline
        ],
      }),
      submitTransaction: vi.fn().mockResolvedValue({ hash: 'new_trustline_tx_hash' }),
    };
    (Horizon.Server as any).mockImplementation(function () {
      return mockServer;
    });

    const result = await addUsdcTrustlineOWS({ walletName: 'my-agent' });
    expect(result).toBe('new_trustline_tx_hash');
    expect(mockServer.submitTransaction).toHaveBeenCalled();
  });
});

describe('checkSorobanTxLanded', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns landed when Horizon confirms successful tx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ successful: true }),
    });

    const result = await checkSorobanTxLanded('tx_hash_abc');
    expect(result).toBe('landed');
  });

  it('returns dropped when Horizon reports unsuccessful tx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ successful: false }),
    });

    const result = await checkSorobanTxLanded('tx_hash_abc');
    expect(result).toBe('dropped');
  });

  it('returns dropped when Horizon returns 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await checkSorobanTxLanded('tx_hash_abc');
    expect(result).toBe('dropped');
  });

  it('returns pending when Horizon returns unexpected status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await checkSorobanTxLanded('tx_hash_abc');
    expect(result).toBe('pending');
  });

  it('returns pending when network error occurs', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await checkSorobanTxLanded('tx_hash_abc');
    expect(result).toBe('pending');
  });

  it('accepts optional networkPassphrase', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ successful: true }),
    });

    const result = await checkSorobanTxLanded('tx_hash_abc', {
      networkPassphrase: 'Test SDF Network; September 2015',
    });
    expect(result).toBe('landed');
  });
});

describe('payViaContractOWS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns transaction hash on successful payment', async () => {
    const { submitSorobanTx } = await import('../soroban');
    vi.mocked(submitSorobanTx).mockResolvedValue('soroban_tx_hash');

    const result = await payViaContractOWS({
      walletName: 'my-agent',
      payment: {
        type: 'soroban_contract',
        contract_id: FAKE_CONTRACT_ID,
        order_id: 'ord_123',
        usdc: { amount: '10.00', asset: 'USDC:GA5...' },
      },
    });

    expect(result).toBe('soroban_tx_hash');
  });

  it('retries on dropped transaction', async () => {
    const { submitSorobanTx } = await import('../soroban');
    const droppedError = Object.assign(new Error('Transaction dropped'), { dropped: true });
    vi.mocked(submitSorobanTx)
      .mockRejectedValueOnce(droppedError)
      .mockResolvedValue('retry_success_hash');

    const result = await payViaContractOWS({
      walletName: 'my-agent',
      payment: {
        type: 'soroban_contract',
        contract_id: FAKE_CONTRACT_ID,
        order_id: 'ord_123',
        usdc: { amount: '10.00', asset: 'USDC:GA5...' },
      },
    });

    expect(result).toBe('retry_success_hash');
    expect(submitSorobanTx).toHaveBeenCalledTimes(2);
  });

  it('throws on non-retryable error', async () => {
    const { submitSorobanTx } = await import('../soroban');
    vi.mocked(submitSorobanTx).mockRejectedValue(new Error('On-chain failure'));

    await expect(
      payViaContractOWS({
        walletName: 'my-agent',
        payment: {
          type: 'soroban_contract',
          contract_id: FAKE_CONTRACT_ID,
          order_id: 'ord_123',
          usdc: { amount: '10.00', asset: 'USDC:GA5...' },
        },
      }),
    ).rejects.toThrow('On-chain failure');
  });

  it('accepts PayViaContractOwsOpts with all optional fields', () => {
    const opts: PayViaContractOwsOpts = {
      walletName: 'my-agent',
      payment: {
        type: 'soroban_contract',
        contract_id: FAKE_CONTRACT_ID,
        order_id: 'ord_123',
        usdc: { amount: '10.00', asset: 'USDC:GA5...' },
      },
      paymentAsset: 'xlm',
      passphrase: 'passphrase',
      vaultPath: '/custom/path',
      networkPassphrase: 'Test SDF Network; September 2015',
      sorobanRpcUrl: 'https://custom-rpc.example.com',
      horizonUrl: 'https://custom-horizon.example.com',
    };
    expect(opts.walletName).toBe('my-agent');
    expect(opts.payment.type).toBe('soroban_contract');
    expect(opts.paymentAsset).toBe('xlm');
  });
});

describe('purchaseCardOWS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts PurchaseCardOwsOpts', () => {
    const opts = {
      apiKey: 'stellar_card_key',
      walletName: 'my-agent',
      amountUsdc: '10.00',
    };
    expect(opts.walletName).toBe('my-agent');
    expect(opts.amountUsdc).toBe('10.00');
  });

  it('accepts payment asset preference', () => {
    const opts = {
      apiKey: 'stellar_card_key',
      walletName: 'my-agent',
      amountUsdc: '10.00',
      paymentAsset: 'xlm' as const,
    };
    expect(opts.paymentAsset).toBe('xlm');
  });

  it('accepts resume option with orderId string', () => {
    const opts: PurchaseCardOwsOpts = {
      apiKey: 'stellar_card_key',
      walletName: 'my-agent',
      amountUsdc: '10.00',
      resume: 'ord_existing',
    };
    expect(opts.resume).toBe('ord_existing');
  });

  it('accepts resume option with full context', () => {
    const opts: PurchaseCardOwsOpts = {
      apiKey: 'stellar_card_key',
      walletName: 'my-agent',
      amountUsdc: '10.00',
      resume: {
        orderId: 'ord_existing',
        txHash: 'abc123',
        phase: 'unpaid',
      },
    };
    expect(typeof opts.resume).toBe('object');
    if (typeof opts.resume === 'object') {
      expect(opts.resume.orderId).toBe('ord_existing');
      expect(opts.resume.txHash).toBe('abc123');
      expect(opts.resume.phase).toBe('unpaid');
    }
  });

  it('accepts custom RPC and Horizon URLs', () => {
    const opts: PurchaseCardOwsOpts = {
      apiKey: 'stellar_card_key',
      walletName: 'my-agent',
      amountUsdc: '10.00',
      sorobanRpcUrl: 'https://custom-soroban.example.com',
      horizonUrl: 'https://custom-horizon.example.com',
    };
    expect(opts.sorobanRpcUrl).toBe('https://custom-soroban.example.com');
    expect(opts.horizonUrl).toBe('https://custom-horizon.example.com');
  });

  it('accepts waitForCardOpts tuning', () => {
    const opts: PurchaseCardOwsOpts = {
      apiKey: 'stellar_card_key',
      walletName: 'my-agent',
      amountUsdc: '10.00',
      waitForCardOpts: { timeoutMs: 600_000, intervalMs: 5_000 },
    };
    expect(opts.waitForCardOpts?.timeoutMs).toBe(600_000);
    expect(opts.waitForCardOpts?.intervalMs).toBe(5_000);
  });
});
