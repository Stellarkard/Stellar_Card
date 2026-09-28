import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Horizon } from '@stellar/stellar-sdk';
import { estimateXlmRequired } from '../stellar';
import { Stellar_CardClient } from '../client';

describe('estimateXlmRequired', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('estimates XLM required from Horizon orderbook asks with default 1% slippage', async () => {
    // 1 USDC = 8.0 XLM on top ask
    const mockOrderbookCall = vi.fn().mockResolvedValue({
      asks: [
        { price: '8.0000000', amount: '1000.0000000' },
        { price: '8.1000000', amount: '500.0000000' },
      ],
      bids: [],
    });

    vi.spyOn(Horizon.Server.prototype, 'orderbook').mockReturnValue({
      call: mockOrderbookCall,
    } as any);

    // 10 USDC * 8.0 XLM/USDC * 1.01 (1% slippage) = 80.8000000 XLM
    const estimate = await estimateXlmRequired('10.00');

    expect(estimate.effectiveRate).toBe(8.0);
    expect(estimate.slippageApplied).toBe(0.01);
    expect(estimate.xlmAmount).toBe('80.8000000');
    expect(estimate.stroops).toBe('808000000');
    expect(new Date(estimate.expiresAt).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('applies custom slippage buffer and custom TTL', async () => {
    const mockOrderbookCall = vi.fn().mockResolvedValue({
      asks: [{ price: '10.0000000', amount: '500.0000000' }],
      bids: [],
    });

    vi.spyOn(Horizon.Server.prototype, 'orderbook').mockReturnValue({
      call: mockOrderbookCall,
    } as any);

    const now = Date.now();
    // 5 USDC * 10 XLM/USDC * 1.05 (5% slippage) = 52.5000000 XLM = 525000000 stroops
    const estimate = await estimateXlmRequired(5, {
      slippage: 0.05,
      quoteTtlMs: 30000,
    });

    expect(estimate.effectiveRate).toBe(10.0);
    expect(estimate.slippageApplied).toBe(0.05);
    expect(estimate.xlmAmount).toBe('52.5000000');
    expect(estimate.stroops).toBe('525000000');

    const expiresAtMs = new Date(estimate.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(now + 29000);
    expect(expiresAtMs).toBeLessThanOrEqual(now + 31000);
  });

  it('falls back to custom price quote fetcher when orderbook fails', async () => {
    vi.spyOn(Horizon.Server.prototype, 'orderbook').mockReturnValue({
      call: vi.fn().mockRejectedValue(new Error('Network connection timeout')),
    } as any);

    const fetchPriceQuote = vi.fn().mockResolvedValue(7.5);

    // 20 USDC * 7.5 XLM/USDC * 1.01 = 151.5000000 XLM
    const estimate = await estimateXlmRequired('20.00', {
      fetchPriceQuote,
    });

    expect(fetchPriceQuote).toHaveBeenCalledTimes(1);
    expect(estimate.effectiveRate).toBe(7.5);
    expect(estimate.xlmAmount).toBe('151.5000000');
    expect(estimate.stroops).toBe('1515000000');
  });

  it('throws descriptive error on invalid USDC amount', async () => {
    await expect(estimateXlmRequired('-5')).rejects.toThrowError(
      /Invalid USDC amount for estimation/,
    );
    await expect(estimateXlmRequired('abc')).rejects.toThrowError(
      /Invalid USDC amount for estimation/,
    );
  });

  it('throws informative fallback message when both orderbook and fallback quote fail', async () => {
    vi.spyOn(Horizon.Server.prototype, 'orderbook').mockReturnValue({
      call: vi.fn().mockRejectedValue(new Error('socket hang up')),
    } as any);

    await expect(estimateXlmRequired('10.00')).rejects.toThrowError(
      /Failed to estimate XLM required: unable to fetch USDC\/XLM price quote from Horizon orderbook: socket hang up. Fallback price source unavailable./,
    );
  });

  it('can be called directly through Stellar_CardClient', async () => {
    const mockOrderbookCall = vi.fn().mockResolvedValue({
      asks: [{ price: '8.0000000', amount: '100.00' }],
      bids: [],
    });

    vi.spyOn(Horizon.Server.prototype, 'orderbook').mockReturnValue({
      call: mockOrderbookCall,
    } as any);

    const client = new Stellar_CardClient({ apiKey: 'stellar_card_test_key_123456789' });
    const result = await client.estimateXlmRequired('10.00');

    expect(result.effectiveRate).toBe(8.0);
    expect(result.xlmAmount).toBe('80.8000000');
    expect(result.stroops).toBe('808000000');
  });
});
