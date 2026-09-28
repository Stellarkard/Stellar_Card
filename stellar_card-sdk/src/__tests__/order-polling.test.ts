import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Stellar_CardClient, type OrderStatus } from '../client';
import { OrderFailedError, TimeoutError, AbortError } from '../errors';

describe('waitForOrderFulfillment (#713)', () => {
  let client: Stellar_CardClient;
  let getOrderMock: ReturnType<typeof vi.fn>;

  const baseOrder: OrderStatus = {
    order_id: 'ord-test-123',
    status: 'pending_payment',
    phase: 'awaiting_payment',
    amount_usdc: '25.00',
    payment_asset: 'USDC',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    client = new Stellar_CardClient({
      apiKey: 'test-api-key',
      disableVersionCheck: true,
    });
    getOrderMock = vi.fn();
    // Intercept getOrder
    vi.spyOn(client, 'getOrder').mockImplementation(getOrderMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('polls order until status reaches ACTIVE and resolves with the completed order', async () => {
    getOrderMock
      .mockResolvedValueOnce({ ...baseOrder, status: 'pending_payment', phase: 'awaiting_payment' })
      .mockResolvedValueOnce({ ...baseOrder, status: 'processing', phase: 'processing' })
      .mockResolvedValueOnce({
        ...baseOrder,
        status: 'ACTIVE',
        phase: 'ready',
        card: {
          number: '4111111111111111',
          cvv: '123',
          expiry: '12/28',
          brand: 'Visa',
        },
      });

    const promise = client.waitForOrderFulfillment('ord-test-123', {
      intervalMs: 1000,
      timeoutMs: 30000,
    });

    // Step 1
    await vi.advanceTimersByTimeAsync(0);
    expect(getOrderMock).toHaveBeenCalledTimes(1);

    // Step 2
    await vi.advanceTimersByTimeAsync(1000);
    expect(getOrderMock).toHaveBeenCalledTimes(2);

    // Step 3
    await vi.advanceTimersByTimeAsync(1000);
    expect(getOrderMock).toHaveBeenCalledTimes(3);

    const completed = await promise;
    expect(completed.status).toBe('ACTIVE');
    expect(completed.card?.number).toBe('4111111111111111');
  });

  it('invokes onProgress callback on each state transition', async () => {
    const onProgress = vi.fn();

    getOrderMock
      .mockResolvedValueOnce({ ...baseOrder, status: 'pending_payment', phase: 'awaiting_payment' })
      .mockResolvedValueOnce({ ...baseOrder, status: 'pending_payment', phase: 'awaiting_payment' }) // Duplicate state
      .mockResolvedValueOnce({ ...baseOrder, status: 'processing', phase: 'processing' })
      .mockResolvedValueOnce({
        ...baseOrder,
        status: 'ACTIVE',
        phase: 'ready',
        card: { number: '4000000000000000', cvv: '999', expiry: '01/29', brand: 'Visa' },
      });

    const promise = client.waitForOrderFulfillment('ord-test-123', {
      intervalMs: 500,
      timeoutMs: 10000,
      onProgress,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'pending_payment' }),
    );

    // Same state, should NOT call onProgress again
    await vi.advanceTimersByTimeAsync(500);
    expect(onProgress).toHaveBeenCalledTimes(1);

    // Transition to processing
    await vi.advanceTimersByTimeAsync(500);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'processing' }));

    // Transition to ACTIVE
    await vi.advanceTimersByTimeAsync(500);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ACTIVE' }));

    const res = await promise;
    expect(res.status).toBe('ACTIVE');
  });

  it('rejects with OrderFailedError when order enters terminal failed state', async () => {
    getOrderMock
      .mockResolvedValueOnce({ ...baseOrder, status: 'pending_payment', phase: 'awaiting_payment' })
      .mockResolvedValueOnce({
        ...baseOrder,
        status: 'FAILED',
        phase: 'failed',
        error: 'Payment rejected by risk engine',
      });

    const promise = client.waitForOrderFulfillment('ord-test-123', {
      intervalMs: 1000,
      timeoutMs: 10000,
    });

    const rejectPromise = expect(promise).rejects.toThrow(OrderFailedError);

    await vi.advanceTimersByTimeAsync(1000);

    await rejectPromise;
  });

  it('rejects with OrderFailedError when order is refunded or expired', async () => {
    getOrderMock.mockResolvedValueOnce({
      ...baseOrder,
      status: 'EXPIRED',
      phase: 'expired',
      error: 'Order expired',
    });

    const promise = client.waitForOrderFulfillment('ord-test-123', {
      intervalMs: 1000,
    });

    await expect(promise).rejects.toThrow(OrderFailedError);
  });

  it('rejects with TimeoutError when polling exceeds timeoutMs', async () => {
    // Keep returning pending_payment
    getOrderMock.mockResolvedValue({
      ...baseOrder,
      status: 'pending_payment',
      phase: 'awaiting_payment',
    });

    const promise = client.waitForOrderFulfillment('ord-test-123', {
      intervalMs: 1000,
      timeoutMs: 3000,
    });

    const rejectPromise = expect(promise).rejects.toThrow(TimeoutError);

    await vi.advanceTimersByTimeAsync(3500);

    await rejectPromise;
  });

  it('rejects with AbortError when signal is aborted', async () => {
    getOrderMock.mockResolvedValue({
      ...baseOrder,
      status: 'pending_payment',
    });

    const controller = new AbortController();

    const promise = client.waitForOrderFulfillment('ord-test-123', {
      intervalMs: 1000,
      timeoutMs: 10000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toThrow(AbortError);
  });

  it('uses default 2s interval and 120s timeout if unspecified', async () => {
    getOrderMock
      .mockResolvedValueOnce({ ...baseOrder, status: 'pending' })
      .mockResolvedValueOnce({ ...baseOrder, status: 'ACTIVE' });

    const promise = client.waitForOrderFulfillment('ord-test-123');

    // First call immediate
    await vi.advanceTimersByTimeAsync(0);
    expect(getOrderMock).toHaveBeenCalledTimes(1);

    // Before 2s (e.g. 1500ms), second call should not happen yet
    await vi.advanceTimersByTimeAsync(1500);
    expect(getOrderMock).toHaveBeenCalledTimes(1);

    // At 2000ms, second call happens
    await vi.advanceTimersByTimeAsync(500);
    expect(getOrderMock).toHaveBeenCalledTimes(2);

    const completed = await promise;
    expect(completed.status).toBe('ACTIVE');
  });
});
