import { describe, it, expect, vi } from 'vitest';
import { handleGenerateCardPaymentUrl } from '../mcp';
import type { Stellar_CardClient } from '../client';

describe('MCP Tool: generate_card_payment_url (#707)', () => {
  it('generates a valid payment URL and instructions for standard amount', async () => {
    const result = await handleGenerateCardPaymentUrl({
      amount: '25.00',
      currency: 'USD',
      merchant: 'Acme Coffee',
      memo: 'Order #101',
    });

    expect(result.order_id).toBeDefined();
    expect(result.amount).toBe('25.00');
    expect(result.currency).toBe('USD');
    expect(result.merchant).toBe('Acme Coffee');
    expect(result.memo).toBe('Order #101');
    expect(result.payment_url).toContain(`/checkout/${result.order_id}`);
    expect(result.payment_url).toContain('amount=25.00');
    expect(result.payment_url).toContain('currency=USD');
    expect(result.payment_url).toContain('merchant=Acme+Coffee');
    expect(result.payment_url).toContain('memo=Order+%23101');
    expect(result.qr_data).toContain('web+stellar:pay?');
    expect(result.instructions).toContain(result.payment_url);
  });

  it('defaults currency to USD if omitted', async () => {
    const result = await handleGenerateCardPaymentUrl({
      amount: '10.00',
    });

    expect(result.currency).toBe('USD');
    expect(result.payment_url).toContain('currency=USD');
    expect(result.merchant).toBeUndefined();
    expect(result.memo).toBeUndefined();
  });

  it('uses order from Stellar_CardClient when client is provided', async () => {
    const mockClient = {
      createOrder: vi.fn().mockResolvedValue({
        order_id: 'client-order-uuid-999',
        status: 'awaiting_payment',
      }),
    } as unknown as Stellar_CardClient;

    const result = await handleGenerateCardPaymentUrl(
      {
        amount: '50.00',
        currency: 'USDC',
      },
      mockClient,
    );

    expect(mockClient.createOrder).toHaveBeenCalledWith({
      amount_usdc: '50.00',
      metadata: {
        currency: 'USDC',
        merchant: undefined,
        memo: undefined,
      },
    });
    expect(result.order_id).toBe('client-order-uuid-999');
    expect(result.payment_url).toContain('/checkout/client-order-uuid-999');
  });

  it('strictly validates amount parameter', async () => {
    await expect(handleGenerateCardPaymentUrl(null)).rejects.toThrow(/arguments must be an object/);

    await expect(handleGenerateCardPaymentUrl({})).rejects.toThrow(/'amount' is required/);

    await expect(handleGenerateCardPaymentUrl({ amount: 'invalid' })).rejects.toThrow(
      /'amount' is required and must be a positive decimal string/,
    );

    await expect(handleGenerateCardPaymentUrl({ amount: '0.00' })).rejects.toThrow(
      /'amount' must be between 0.01 and 10000.00/,
    );

    await expect(handleGenerateCardPaymentUrl({ amount: '100000.00' })).rejects.toThrow(
      /'amount' must be between 0.01 and 10000.00/,
    );
  });

  it('strictly validates optional string parameters', async () => {
    await expect(
      handleGenerateCardPaymentUrl({ amount: '10.00', currency: 123 as unknown as string }),
    ).rejects.toThrow(/'currency' must be a string/);

    await expect(
      handleGenerateCardPaymentUrl({
        amount: '10.00',
        merchant: { name: 'Store' } as unknown as string,
      }),
    ).rejects.toThrow(/'merchant' must be a string/);

    await expect(
      handleGenerateCardPaymentUrl({ amount: '10.00', memo: true as unknown as string }),
    ).rejects.toThrow(/'memo' must be a string/);
  });
});
