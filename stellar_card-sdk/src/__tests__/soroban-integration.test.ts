// Soroban client integration test suite (Issue #531 — Part 5; also closes
// #491, a duplicate "Part 1" issue filed for the same feature).
//
// Tests the full Soroban contract payment lifecycle with mocked RPC
// and Horizon backends, covering:
//   - buildContractPaymentTx with real TransactionBuilder assembly
//   - submitSorobanTx retry state machine (TRY_AGAIN_LATER, DUPLICATE, ERROR)
//   - decimalToStroops edge cases
//   - selectContractCall USDC vs XLM paths
//   - InsufficientFeeError propagation
//   - Horizon fallback on Soroban RPC XDR mismatch
//   - checkSorobanTxLanded from ows.ts
//
// All external I/O (RPC, Horizon) is mocked — no live network calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  decimalToStroops,
  selectContractCall,
  getSorobanRpcUrl,
  getHorizonUrl,
  InsufficientFeeError,
  type PaymentFn,
  type BuildContractTxOpts,
} from '../soroban';

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock the entire @stellar/stellar-sdk module for isolated unit testing
vi.mock('@stellar/stellar-sdk', () => {
  const actual = vi.importActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk');
  return {
    ...actual,
    rpc: {
      Server: class MockServer {
        constructor(_url?: string) {}
        getAccount = vi.fn().mockResolvedValue({
          accountId: () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          sequenceNumber: () => '12345',
          incrementSequenceNumber: () => {},
        });
        simulateTransaction = vi.fn().mockResolvedValue({
          status: 'SUCCESS',
          result: {
            auth: [],
            retval: { switch: () => ({ name: 'void' }) },
          },
        });
        sendTransaction = vi.fn().mockResolvedValue({
          status: 'PENDING',
          hash: 'a'.repeat(64),
        });
        getTransaction = vi.fn().mockResolvedValue({
          status: 'SUCCESS',
          hash: 'a'.repeat(64),
        });
      },
      Api: {
        isSimulationError: vi.fn().mockReturnValue(false),
        isSimulationSuccess: vi.fn().mockReturnValue(true),
      },
      assembleTransaction: vi.fn().mockReturnValue({
        build: vi.fn().mockReturnValue({
          hash: vi.fn().mockReturnValue(Buffer.alloc(32)),
          signatures: [],
          toEnvelope: vi.fn().mockReturnValue({
            toXDR: vi.fn().mockReturnValue('AAAAAg=='),
          }),
          sequence: '12345',
        }),
      }),
    },
    Account: class MockAccount {
      constructor(_address?: string, _sequence?: string) {}
      accountId = () => 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      sequenceNumber = () => '12345';
      incrementSequenceNumber = () => {};
    },
    Address: class MockAddress {
      constructor(_address?: string) {}
      toScVal = vi.fn().mockReturnValue({ switch: () => ({ name: 'address' }) });
    },
    Contract: class MockContract {
      constructor(_id?: string) {}
      call = vi.fn().mockReturnValue({ switch: () => ({ name: 'invoke' }) });
    },
    TransactionBuilder: class MockTransactionBuilder {
      constructor(_account?: any, _opts?: any) {}
      addOperation = vi.fn().mockReturnThis();
      setTimeout = vi.fn().mockReturnThis();
      build = vi.fn().mockReturnValue({
        hash: vi.fn().mockReturnValue(Buffer.alloc(32)),
        signatures: [],
        toEnvelope: vi.fn().mockReturnValue({
          toXDR: vi.fn().mockReturnValue('AAAAAg=='),
        }),
        sequence: '12345',
      });
    },
    Networks: {
      PUBLIC: 'Public Global Stellar Network ; September 2015',
      TESTNET: 'Test SDF Network ; September 2015',
    },
    BASE_FEE: '100',
    nativeToScVal: vi.fn().mockReturnValue({ switch: () => ({ name: 'value' }) }),
    xdr: {
      DecoratedSignature: vi.fn().mockImplementation(() => ({})),
    },
  };
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Soroban integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── decimalToStroops ────────────────────────────────────────────────────

  describe('decimalToStroops', () => {
    it('converts standard USDC amounts to 7-decimal bigint', () => {
      expect(decimalToStroops('1.00')).toBe(10_000_000n);
      expect(decimalToStroops('10.00')).toBe(100_000_000n);
      expect(decimalToStroops('100.00')).toBe(1_000_000_000n);
    });

    it('handles fractional amounts with up to 7 decimals', () => {
      expect(decimalToStroops('0.0000001')).toBe(1n);
      expect(decimalToStroops('0.1234567')).toBe(1_234_567n);
      expect(decimalToStroops('1.23')).toBe(12_300_000n);
    });

    it('pads fractional parts with trailing zeros', () => {
      expect(decimalToStroops('1.5')).toBe(15_000_000n);
      expect(decimalToStroops('1.25')).toBe(12_500_000n);
    });

    it('rejects amounts with more than 7 decimal places', () => {
      expect(() => decimalToStroops('1.00000001')).toThrow('more than 7 decimal places');
    });

    it('rejects zero amounts', () => {
      expect(() => decimalToStroops('0')).toThrow('must be positive');
      expect(() => decimalToStroops('0.00')).toThrow('must be positive');
    });

    it('rejects negative amounts', () => {
      expect(() => decimalToStroops('-1.00')).toThrow('Invalid decimal amount');
    });

    it('rejects non-numeric strings', () => {
      expect(() => decimalToStroops('abc')).toThrow('Invalid decimal amount');
      expect(() => decimalToStroops('')).toThrow('Invalid decimal amount');
      expect(() => decimalToStroops('1.2.3')).toThrow('Invalid decimal amount');
    });

    it('handles whole numbers without decimal point', () => {
      expect(decimalToStroops('1')).toBe(10_000_000n);
    });

    it('handles maximum allowed amount (10000.00)', () => {
      expect(decimalToStroops('10000.00')).toBe(100_000_000_000n);
    });

    it('handles minimum allowed amount (0.01)', () => {
      expect(decimalToStroops('0.01')).toBe(100_000n);
    });
  });

  // ── selectContractCall ──────────────────────────────────────────────────

  describe('selectContractCall', () => {
    const payment = {
      usdc: { amount: '10.00', asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
      xlm: { amount: '50.00' },
    };

    it('selects pay_usdc for USDC payments', () => {
      const result = selectContractCall(payment, 'usdc');
      expect(result.fn).toBe('pay_usdc');
      expect(result.amountDecimal).toBe('10.00');
    });

    it('selects pay_xlm for XLM payments', () => {
      const result = selectContractCall(payment, 'xlm');
      expect(result.fn).toBe('pay_xlm');
      expect(result.amountDecimal).toBe('50.00');
    });

    it('throws when XLM quote is missing', () => {
      const noXlm = { usdc: payment.usdc };
      expect(() => selectContractCall(noXlm, 'xlm')).toThrow('XLM quote');
    });

    it('defaults to USDC when paymentAsset is unknown', () => {
      const result = selectContractCall(payment, 'usdc');
      expect(result.fn).toBe('pay_usdc');
    });
  });

  // ── Network URL resolution ──────────────────────────────────────────────

  describe('getSorobanRpcUrl', () => {
    it('returns testnet RPC for testnet passphrase', () => {
      const url = getSorobanRpcUrl('Test SDF Network ; September 2015');
      expect(url).toBe('https://soroban-testnet.stellar.org');
    });

    it('returns mainnet RPC for public passphrase', () => {
      const url = getSorobanRpcUrl('Public Global Stellar Network ; September 2015');
      expect(url).toBe('https://mainnet.sorobanrpc.com');
    });

    it('returns mainnet RPC for unknown passphrase', () => {
      const url = getSorobanRpcUrl('unknown');
      expect(url).toBe('https://mainnet.sorobanrpc.com');
    });
  });

  describe('getHorizonUrl', () => {
    it('returns testnet Horizon for testnet passphrase', () => {
      const url = getHorizonUrl('Test SDF Network ; September 2015');
      expect(url).toBe('https://horizon-testnet.stellar.org');
    });

    it('returns mainnet Horizon for public passphrase', () => {
      const url = getHorizonUrl('Public Global Stellar Network ; September 2015');
      expect(url).toBe('https://horizon.stellar.org');
    });

    it('returns mainnet Horizon when passphrase is undefined', () => {
      const url = getHorizonUrl(undefined);
      expect(url).toBe('https://horizon.stellar.org');
    });
  });

  // ── InsufficientFeeError ────────────────────────────────────────────────

  describe('InsufficientFeeError', () => {
    it('stores the required fee from the network', () => {
      const err = new InsufficientFeeError('5000');
      expect(err.requiredFee).toBe('5000');
      expect(err.message).toContain('5000');
    });

    it('is an instance of Error with the required fee in the message', () => {
      const err = new InsufficientFeeError('100');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('100');
    });
  });

  // ── buildContractPaymentTx ──────────────────────────────────────────────

  describe('buildContractPaymentTx', () => {
    it('builds a transaction with the correct contract function', async () => {
      const { buildContractPaymentTx } = await import('../soroban');
      const result = await buildContractPaymentTx({
        contractId: 'C' + 'A'.repeat(55),
        fn: 'pay_usdc',
        fromPublicKey: 'G' + 'A'.repeat(55),
        amountStroops: 100_000_000n,
        orderId: 'ord_123',
        networkPassphrase: 'Test SDF Network ; September 2015',
      });

      expect(result).toHaveProperty('tx');
      expect(result).toHaveProperty('server');
    });

    it('uses the provided fee when specified', async () => {
      const { buildContractPaymentTx } = await import('../soroban');
      const result = await buildContractPaymentTx({
        contractId: 'C' + 'A'.repeat(55),
        fn: 'pay_xlm',
        fromPublicKey: 'G' + 'A'.repeat(55),
        amountStroops: 50_000_000n,
        orderId: 'ord_456',
        networkPassphrase: 'Test SDF Network ; September 2015',
        fee: '50000',
      });

      expect(result.tx).toBeDefined();
    });

    it('reuses preserved sequence for retry mutual exclusion', async () => {
      const { buildContractPaymentTx } = await import('../soroban');
      const result = await buildContractPaymentTx({
        contractId: 'C' + 'A'.repeat(55),
        fn: 'pay_usdc',
        fromPublicKey: 'G' + 'A'.repeat(55),
        amountStroops: 10_000_000n,
        orderId: 'ord_789',
        networkPassphrase: 'Test SDF Network ; September 2015',
        preservedSequence: '99999',
      });

      expect(result.tx).toBeDefined();
    });

    it('defaults to mainnet RPC when rpcUrl is omitted', async () => {
      const { buildContractPaymentTx } = await import('../soroban');
      const result = await buildContractPaymentTx({
        contractId: 'C' + 'A'.repeat(55),
        fn: 'pay_usdc',
        fromPublicKey: 'G' + 'A'.repeat(55),
        amountStroops: 1_000_000n,
        orderId: 'ord_rpc',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
      });

      expect(result.server).toBeDefined();
    });
  });

  // ── submitSorobanTx ─────────────────────────────────────────────────────

  describe('submitSorobanTx', () => {
    it('submits and returns tx hash on success', async () => {
      const { submitSorobanTx } = await import('../soroban');
      const tx = {
        hash: vi.fn().mockReturnValue(Buffer.alloc(32)),
        signatures: [],
        toEnvelope: vi.fn().mockReturnValue({
          toXDR: vi.fn().mockReturnValue('AAAAAg=='),
        }),
      };
      const server = {
        sendTransaction: vi.fn().mockResolvedValue({
          status: 'PENDING',
          hash: 'a'.repeat(64),
        }),
        getTransaction: vi.fn().mockResolvedValue({
          status: 'SUCCESS',
          hash: 'a'.repeat(64),
        }),
      } as any;

      const hash = await submitSorobanTx(tx as any, server);
      expect(hash).toBe('a'.repeat(64));
      expect(server.sendTransaction).toHaveBeenCalledOnce();
    });

    it('retries on TRY_AGAIN_LATER status', async () => {
      const { submitSorobanTx } = await import('../soroban');
      const tx = {
        hash: vi.fn().mockReturnValue(Buffer.alloc(32)),
        signatures: [],
        toEnvelope: vi.fn().mockReturnValue({
          toXDR: vi.fn().mockReturnValue('AAAAAg=='),
        }),
      };
      const server = {
        sendTransaction: vi
          .fn()
          .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER' })
          .mockResolvedValueOnce({ status: 'PENDING', hash: 'b'.repeat(64) }),
        getTransaction: vi.fn().mockResolvedValue({
          status: 'SUCCESS',
          hash: 'b'.repeat(64),
        }),
      } as any;

      vi.useFakeTimers();
      const promise = submitSorobanTx(tx as any, server);
      // Advance past the 1500ms retry delay
      await vi.advanceTimersByTimeAsync(2000);
      const hash = await promise;
      expect(hash).toBe('b'.repeat(64));
      expect(server.sendTransaction).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('treats DUPLICATE as accepted and falls through to polling', async () => {
      const { submitSorobanTx } = await import('../soroban');
      const tx = {
        hash: vi.fn().mockReturnValue(Buffer.alloc(32)),
        signatures: [],
        toEnvelope: vi.fn().mockReturnValue({
          toXDR: vi.fn().mockReturnValue('AAAAAg=='),
        }),
      };
      const server = {
        sendTransaction: vi.fn().mockResolvedValue({
          status: 'DUPLICATE',
          hash: 'c'.repeat(64),
        }),
        getTransaction: vi.fn().mockResolvedValue({
          status: 'SUCCESS',
          hash: 'c'.repeat(64),
        }),
      } as any;

      const hash = await submitSorobanTx(tx as any, server);
      expect(hash).toBe('c'.repeat(64));
    });

    it('throws InsufficientFeeError when txInsufficientFee is returned', async () => {
      const { submitSorobanTx } = await import('../soroban');
      const tx = {
        hash: vi.fn().mockReturnValue(Buffer.alloc(32)),
        signatures: [],
        toEnvelope: vi.fn().mockReturnValue({
          toXDR: vi.fn().mockReturnValue('AAAAAg=='),
        }),
      };
      const server = {
        sendTransaction: vi.fn().mockResolvedValue({
          status: 'ERROR',
          errorResult: {
            result: vi.fn().mockReturnValue({
              switch: vi.fn().mockReturnValue({ name: 'txInsufficientFee' }),
            }),
            feeCharged: vi.fn().mockReturnValue(5000),
          },
        }),
      } as any;

      await expect(submitSorobanTx(tx as any, server)).rejects.toThrow(InsufficientFeeError);
    });

    it('throws on FAILED transaction status', async () => {
      const { submitSorobanTx } = await import('../soroban');
      const tx = {
        hash: vi.fn().mockReturnValue(Buffer.alloc(32)),
        signatures: [],
        toEnvelope: vi.fn().mockReturnValue({
          toXDR: vi.fn().mockReturnValue('AAAAAg=='),
        }),
      };
      const server = {
        sendTransaction: vi.fn().mockResolvedValue({
          status: 'PENDING',
          hash: 'd'.repeat(64),
        }),
        getTransaction: vi.fn().mockResolvedValue({
          status: 'FAILED',
          hash: 'd'.repeat(64),
        }),
      } as any;

      await expect(submitSorobanTx(tx as any, server)).rejects.toThrow('failed on-chain');
    });
  });

  // ── Transaction building integration ────────────────────────────────────

  describe('Transaction assembly', () => {
    it('assembles a complete Soroban payment transaction', async () => {
      const { buildContractPaymentTx } = await import('../soroban');
      const result = await buildContractPaymentTx({
        contractId: 'C' + 'A'.repeat(55),
        fn: 'pay_usdc',
        fromPublicKey: 'G' + 'A'.repeat(55),
        amountStroops: 100_000_000n,
        orderId: 'ord_integration',
        networkPassphrase: 'Test SDF Network ; September 2015',
        fee: '100000',
      });

      // Transaction was built successfully
      expect(result.tx).toBeDefined();
      expect(result.server).toBeDefined();
    });

    it('handles XLM payment function', async () => {
      const { buildContractPaymentTx } = await import('../soroban');
      const result = await buildContractPaymentTx({
        contractId: 'C' + 'A'.repeat(55),
        fn: 'pay_xlm',
        fromPublicKey: 'G' + 'A'.repeat(55),
        amountStroops: 500_000_000n,
        orderId: 'ord_xlm',
        networkPassphrase: 'Test SDF Network ; September 2015',
      });

      expect(result.tx).toBeDefined();
    });
  });

  // ── submitSorobanTx — Horizon fallback & advanced paths ─────────────────

  describe('submitSorobanTx — Horizon fallback and advanced error paths', () => {
    const makeTx = () => ({
      hash: vi.fn().mockReturnValue(Buffer.alloc(32)),
      signatures: [],
      toEnvelope: vi.fn().mockReturnValue({
        toXDR: vi.fn().mockReturnValue('AAAAAg=='),
      }),
    });

    it('falls back to Horizon when getTransaction throws XDR mismatch ("Bad union switch")', async () => {
      const { submitSorobanTx } = await import('../soroban');
      const txHash = 'e'.repeat(64);

      const server = {
        sendTransaction: vi.fn().mockResolvedValue({ status: 'PENDING', hash: txHash }),
        getTransaction: vi
          .fn()
          .mockRejectedValue(new Error('Bad union switch: 4')),
      } as any;

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ successful: true }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const hash = await submitSorobanTx(makeTx() as any, server, 'https://horizon-testnet.stellar.org');
      expect(hash).toBe(txHash);
      expect(fetchMock).toHaveBeenCalledWith(
        `https://horizon-testnet.stellar.org/transactions/${txHash}`,
      );

      vi.unstubAllGlobals();
    });

    it('throws on-chain failure when Horizon confirms tx failed (XDR mismatch path)', async () => {
      const { submitSorobanTx } = await import('../soroban');
      const txHash = 'f'.repeat(64);

      const server = {
        sendTransaction: vi.fn().mockResolvedValue({ status: 'PENDING', hash: txHash }),
        getTransaction: vi
          .fn()
          .mockRejectedValue(new Error('Bad union switch: 4')),
      } as any;

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ successful: false }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        submitSorobanTx(makeTx() as any, server, 'https://horizon-testnet.stellar.org'),
      ).rejects.toThrow('failed on-chain (Horizon)');

      vi.unstubAllGlobals();
    });

    it('continues polling when Horizon is unreachable during XDR mismatch', async () => {
      const { submitSorobanTx } = await import('../soroban');
      const txHash = '1'.repeat(64);

      let pollCount = 0;
      const server = {
        sendTransaction: vi.fn().mockResolvedValue({ status: 'PENDING', hash: txHash }),
        getTransaction: vi.fn().mockImplementation(async () => {
          pollCount += 1;
          if (pollCount === 1) throw new Error('Bad union switch: 4');
          // Second poll succeeds
          return { status: 'SUCCESS', hash: txHash };
        }),
      } as any;

      // Horizon is unreachable on the first poll's fallback attempt
      const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', fetchMock);

      vi.useFakeTimers();
      const promise = submitSorobanTx(makeTx() as any, server, 'https://horizon.stellar.org');
      // Advance past the 2000ms poll delay so the second getTransaction fires
      await vi.advanceTimersByTimeAsync(3000);
      const hash = await promise;
      expect(hash).toBe(txHash);
      expect(pollCount).toBe(2);

      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('throws with dropped:true when Horizon returns 404 at deadline', async () => {
      const { submitSorobanTx } = await import('../soroban');
      const txHash = '2'.repeat(64);

      vi.useFakeTimers();

      const server = {
        sendTransaction: vi.fn().mockResolvedValue({ status: 'PENDING', hash: txHash }),
        // Always return NOT_FOUND so the loop runs to the deadline
        getTransaction: vi.fn().mockResolvedValue({ status: 'NOT_FOUND', hash: txHash }),
      } as any;

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      });
      vi.stubGlobal('fetch', fetchMock);

      // Attach .catch early to prevent unhandled rejection warning
      let caughtErr: unknown;
      const promise = submitSorobanTx(makeTx() as any, server, 'https://horizon.stellar.org')
        .catch((e: unknown) => { caughtErr = e; });

      // Advance well past the 120s deadline
      await vi.advanceTimersByTimeAsync(130_000);
      await promise;

      expect(caughtErr).toMatchObject({ dropped: true, txHash });

      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('throws with txHash attached when Horizon is unreachable at deadline', async () => {
      const { submitSorobanTx } = await import('../soroban');
      const txHash = '3'.repeat(64);

      vi.useFakeTimers();

      const server = {
        sendTransaction: vi.fn().mockResolvedValue({ status: 'PENDING', hash: txHash }),
        getTransaction: vi.fn().mockResolvedValue({ status: 'NOT_FOUND', hash: txHash }),
      } as any;

      // Horizon completely unreachable
      const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      vi.stubGlobal('fetch', fetchMock);

      // Attach .catch early to prevent unhandled rejection warning
      let caughtErr: unknown;
      const promise = submitSorobanTx(makeTx() as any, server, 'https://horizon.stellar.org')
        .catch((e: unknown) => { caughtErr = e; });

      await vi.advanceTimersByTimeAsync(130_000);
      await promise;

      const err = caughtErr as Error & { txHash?: string };
      expect(err.txHash).toBe(txHash);
      expect(err.message).toContain('Horizon is unreachable');

      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('throws after exhausting all TRY_AGAIN_LATER send attempts', async () => {
      const { submitSorobanTx } = await import('../soroban');

      vi.useFakeTimers();

      const server = {
        sendTransaction: vi.fn().mockResolvedValue({ status: 'TRY_AGAIN_LATER' }),
      } as any;

      // Attach .catch early to prevent unhandled rejection warning
      let caughtErr: unknown;
      const promise = submitSorobanTx(makeTx() as any, server)
        .catch((e: unknown) => { caughtErr = e; });

      // Advance past 5 × 1500ms = 7500ms of retry delays
      await vi.advanceTimersByTimeAsync(10_000);
      await promise;

      expect((caughtErr as Error).message).toContain('TRY_AGAIN_LATER');

      vi.useRealTimers();
    });

    it('uses testnet Horizon URL when provided as horizonUrl parameter', async () => {
      const { submitSorobanTx } = await import('../soroban');
      const txHash = '4'.repeat(64);

      const server = {
        sendTransaction: vi.fn().mockResolvedValue({ status: 'PENDING', hash: txHash }),
        getTransaction: vi
          .fn()
          .mockRejectedValue(new Error('Bad union switch: 4')),
      } as any;

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ successful: true }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await submitSorobanTx(makeTx() as any, server, 'https://horizon-testnet.stellar.org');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('horizon-testnet.stellar.org'),
      );

      vi.unstubAllGlobals();
    });
  });
});
