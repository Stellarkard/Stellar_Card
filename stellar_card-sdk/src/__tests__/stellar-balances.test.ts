// getAccountBalances — batch balance lookup with caching (#701).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Horizon, Keypair, Networks } from '@stellar/stellar-sdk';
import { getAccountBalances, clearBalanceCache, BALANCE_CACHE_TTL_MS } from '../stellar';
import { Stellar_CardClient } from '../client';

const loadAccount = vi.fn();

vi.mock('@stellar/stellar-sdk', async () => {
  const actual =
    await vi.importActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: vi.fn(function (this: { loadAccount: typeof loadAccount }) {
        this.loadAccount = loadAccount;
      }),
    },
  };
});

const USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const PK = Keypair.random().publicKey();

const ACCOUNT = {
  balances: [
    { asset_type: 'native', balance: '12.5000000' },
    {
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: USDC_ISSUER,
      balance: '40.0000000',
    },
    {
      asset_type: 'credit_alphanum12',
      asset_code: 'NEBULA',
      asset_issuer: 'GCUSTOMISSUER',
      balance: '3.0000000',
    },
  ],
};

beforeEach(() => {
  clearBalanceCache();
  loadAccount.mockReset();
  vi.mocked(Horizon.Server).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getAccountBalances', () => {
  it('parses XLM, USDC and custom trustlines from one account call', async () => {
    loadAccount.mockResolvedValue(ACCOUNT);
    const res = await getAccountBalances(PK);
    expect(loadAccount).toHaveBeenCalledTimes(1);
    expect(res.xlm).toBe('12.5000000');
    expect(res.usdc).toBe('40.0000000');
    expect(res.funded).toBe(true);
    expect(res.balances).toEqual([
      { code: 'XLM', issuer: null, assetType: 'native', balance: '12.5000000' },
      { code: 'USDC', issuer: USDC_ISSUER, assetType: 'credit_alphanum4', balance: '40.0000000' },
      {
        code: 'NEBULA',
        issuer: 'GCUSTOMISSUER',
        assetType: 'credit_alphanum12',
        balance: '3.0000000',
      },
    ]);
  });

  it('ignores USDC from an unrecognised issuer', async () => {
    loadAccount.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '1' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GFAKE', balance: '9' },
      ],
    });
    expect((await getAccountBalances(PK)).usdc).toBe('0');
  });

  it('returns zero balances for an unfunded account instead of throwing', async () => {
    loadAccount.mockRejectedValue(
      Object.assign(new Error('Not Found'), { name: 'NotFoundError', response: { status: 404 } }),
    );
    await expect(getAccountBalances(PK)).resolves.toEqual({
      xlm: '0',
      usdc: '0',
      balances: [],
      funded: false,
    });
  });

  it('propagates other Horizon errors and does not cache them', async () => {
    loadAccount.mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(ACCOUNT);
    await expect(getAccountBalances(PK)).rejects.toThrow('503');
    await expect(getAccountBalances(PK)).resolves.toMatchObject({ xlm: '12.5000000' });
  });

  it('rejects an invalid public key without calling Horizon', async () => {
    await expect(getAccountBalances('not-a-key')).rejects.toThrow(/Invalid Stellar public key/);
    expect(loadAccount).not.toHaveBeenCalled();
  });

  it('caches results for 3 seconds per network and account', async () => {
    vi.useFakeTimers();
    loadAccount.mockResolvedValue(ACCOUNT);
    await getAccountBalances(PK);
    await getAccountBalances(PK);
    expect(loadAccount).toHaveBeenCalledTimes(1);

    await getAccountBalances(PK, Networks.TESTNET); // different network → new call
    expect(loadAccount).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(BALANCE_CACHE_TTL_MS + 1);
    await getAccountBalances(PK);
    expect(loadAccount).toHaveBeenCalledTimes(3);
  });

  it('is exposed on Stellar_CardClient using the configured network', async () => {
    loadAccount.mockResolvedValue(ACCOUNT);
    const client = new Stellar_CardClient({
      apiKey: 'k',
      baseUrl: 'https://api.example.com/v1',
      network: 'testnet',
    });
    const res = await client.getAccountBalances(PK);
    expect(res.usdc).toBe('40.0000000');
    expect(vi.mocked(Horizon.Server)).toHaveBeenCalledWith('https://horizon-testnet.stellar.org');
  });
});
