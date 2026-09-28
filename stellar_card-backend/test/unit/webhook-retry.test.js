require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateWebhookBackoff,
  getWebhookRetryDelay,
  WEBHOOK_RETRY_DELAYS_MS,
  MAX_WEBHOOK_ATTEMPTS,
} = require('../../src/fulfillment');

describe('Webhook Retry Logic with Exponential Backoff (Part 3)', () => {
  it('calculates exponential backoff correctly for sequential attempts', () => {
    // Attempt 1 -> 30,000 ms (base)
    // Attempt 2 -> 60,000 ms (30000 * 2^1)
    // Attempt 3 -> 120,000 ms (30000 * 2^2)
    // Attempt 4 -> 240,000 ms (30000 * 2^3)
    assert.equal(calculateWebhookBackoff(1), 30_000);
    assert.equal(calculateWebhookBackoff(2), 60_000);
    assert.equal(calculateWebhookBackoff(3), 120_000);
    assert.equal(calculateWebhookBackoff(4), 240_000);
  });

  it('respects custom backoff options (base, factor, maxDelay)', () => {
    const opts = { baseDelayMs: 1000, factor: 3, maxDelayMs: 10000 };
    assert.equal(calculateWebhookBackoff(1, opts), 1000);
    assert.equal(calculateWebhookBackoff(2, opts), 3000);
    assert.equal(calculateWebhookBackoff(3, opts), 9000);
    // 1000 * 3^3 = 27000, capped at maxDelayMs = 10000
    assert.equal(calculateWebhookBackoff(4, opts), 10000);
  });

  it('getWebhookRetryDelay returns correct predefined delays for configured attempts', () => {
    assert.equal(getWebhookRetryDelay(0), WEBHOOK_RETRY_DELAYS_MS[0]);
    assert.equal(getWebhookRetryDelay(1), WEBHOOK_RETRY_DELAYS_MS[1]);
    assert.equal(getWebhookRetryDelay(2), WEBHOOK_RETRY_DELAYS_MS[2]);
  });

  it('getWebhookRetryDelay uses exponential backoff calculation beyond predefined array', () => {
    // index 3 (attempt 4) -> calculateWebhookBackoff(4) -> 240,000ms
    assert.equal(getWebhookRetryDelay(3), 240_000);
  });

  it('verifies default MAX_WEBHOOK_ATTEMPTS configuration', () => {
    assert.equal(MAX_WEBHOOK_ATTEMPTS, 3);
  });

  // A non-finite delay is not a cosmetic problem. The queue worker does
  // `new Date(Date.now() + delay).toISOString()` inside its catch block;
  // that throws RangeError on NaN, so the `UPDATE webhook_queue SET
  // attempts` never runs, the row stays eligible, and it is retried
  // forever. The old code let NaN through via
  // `calculateWebhookBackoff(3, { factor: NaN })`.
  const nonFinite = [NaN, Infinity, -Infinity, undefined, null, 'x', {}, []];

  it('never returns a non-finite delay from calculateWebhookBackoff', () => {
    for (const bad of nonFinite) {
      for (const attempt of [1, 2, 3, 53]) {
        const d = calculateWebhookBackoff(attempt, { factor: bad });
        assert.ok(Number.isFinite(d), `factor=${String(bad)} attempt=${attempt} -> ${d}`);
        assert.ok(d >= 0, `factor=${String(bad)} attempt=${attempt} -> ${d}`);
      }
    }
  });

  it('never returns a non-finite delay from getWebhookRetryDelay', () => {
    for (const bad of [...nonFinite, -1, 1.5, 1e9]) {
      const d = getWebhookRetryDelay(bad);
      assert.ok(Number.isFinite(d), `attempt=${String(bad)} -> ${d}`);
      assert.ok(d >= 0, `attempt=${String(bad)} -> ${d}`);
    }
  });

  it('cannot produce a tight retry loop from a degenerate factor', () => {
    // factor 0 made every delay 0ms; a negative base made it negative.
    assert.ok(calculateWebhookBackoff(3, { factor: 0 }) >= 1_000);
    assert.ok(calculateWebhookBackoff(3, { baseDelayMs: -5000 }) >= 0);
  });

  it('keeps the delay an integer, so it lands on a valid Date', () => {
    for (const attempt of [1, 2, 3, 1.5, 2.9]) {
      const d = calculateWebhookBackoff(attempt);
      assert.ok(Number.isInteger(d), `attempt=${attempt} -> ${d}`);
      assert.doesNotThrow(() => new Date(Date.now() + d).toISOString());
    }
  });
});
