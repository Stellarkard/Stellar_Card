// Request timeout + AbortSignal support (#699).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { withRequestTimeout, DEFAULT_REQUEST_TIMEOUT_MS } from '../network';
import { Stellar_CardClient } from '../client';
import { AbortError, TimeoutError } from '../errors';

/** A fetch that never resolves until its signal aborts. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
  );
}

function client(opts: { timeout?: number } = {}) {
  return new Stellar_CardClient({
    apiKey: 'test_key',
    baseUrl: 'https://api.test.example/v1',
    retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
    ...opts,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('withRequestTimeout', () => {
  it('defaults to 30s', () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it('resolves when the work finishes in time', async () => {
    await expect(withRequestTimeout('op', async () => 'ok', { timeout: 50 })).resolves.toBe('ok');
  });

  it('throws TimeoutError when the timeout elapses', async () => {
    const work = (signal: AbortSignal) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('x'))));
    await expect(withRequestTimeout('op', work, { timeout: 10 })).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it('throws AbortError when the caller aborts', async () => {
    const ctrl = new AbortController();
    const work = (signal: AbortSignal) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('x'))));
    const p = withRequestTimeout('op', work, { timeout: 1000, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toBeInstanceOf(AbortError);
  });

  it('throws AbortError immediately for an already-aborted signal', async () => {
    const work = vi.fn(async () => 'never');
    await expect(
      withRequestTimeout('op', work, { signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(AbortError);
    expect(work).not.toHaveBeenCalled();
  });

  it('passes through non-abort errors unchanged', async () => {
    const boom = new Error('boom');
    await expect(withRequestTimeout('op', async () => Promise.reject(boom))).rejects.toBe(boom);
  });
});

describe('Stellar_CardClient timeouts and cancellation', () => {
  it('applies the client-level timeout and does not retry it', async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);
    await expect(client({ timeout: 20 }).getUsage()).rejects.toBeInstanceOf(TimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('per-method timeout overrides the client default', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const start = Date.now();
    await expect(client({ timeout: 60_000 }).getOrder('ord_1', { timeout: 20 })).rejects.toThrow(
      /timed out after 20ms/,
    );
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  it('cancels via a caller AbortSignal on every method', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const c = client();
    const calls = [
      (signal: AbortSignal) => c.getUsage({ signal }),
      (signal: AbortSignal) => c.getOrder('ord_1', { signal }),
      (signal: AbortSignal) => c.listOrders({ signal }),
      (signal: AbortSignal) => c.createOrder({ amount_usdc: '10.00', signal }),
    ];
    for (const call of calls) {
      const ctrl = new AbortController();
      const p = call(ctrl.signal);
      ctrl.abort();
      await expect(p).rejects.toBeInstanceOf(AbortError);
    }
  });

  it('forwards an AbortSignal to fetch and strips timeout/signal from the order body', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ order_id: 'o' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await client().createOrder({ amount_usdc: '5.00', timeout: 1000 });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({ amount_usdc: '5.00' });
  });
});
