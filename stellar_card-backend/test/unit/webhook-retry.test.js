require('../helpers/env');

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { subscribe } = require('../../src/lib/event-bus');
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

// ── Part 4: core configuration — env-tunable retry ladder ──────────────────
//
// The attempt ceiling and the exponential-backoff base/factor/cap are ops
// knobs, resolved lazily so jobs.js::retryWebhooks and the exported schedule
// agree at runtime. Corrupt or out-of-range values fall back to the documented
// defaults and fire a ONE-TIME webhook.retry_config_invalid bizEvent — a
// misconfigured env (e.g. a 0 base, which would be a tight retry loop) must
// never silently change the queue schedule.
describe('Webhook Retry Logic with Exponential Backoff (Part 4): configurable retry ladder', () => {
  const {
    webhookRetryConfig,
    getWebhookMaxAttempts,
    _resetWebhookRetryConfigWarned,
  } = require('../../src/fulfillment');

  const CONFIG_KEYS = [
    'WEBHOOK_MAX_ATTEMPTS',
    'WEBHOOK_RETRY_BASE_DELAY_MS',
    'WEBHOOK_RETRY_FACTOR',
    'WEBHOOK_RETRY_MAX_DELAY_MS',
  ];

  const saved = {};
  let captured;
  let unsubscribe;

  beforeEach(() => {
    _resetWebhookRetryConfigWarned();
    if (!Object.keys(saved).length) {
      for (const key of CONFIG_KEYS) saved[key] = process.env[key];
    }
    captured = [];
    unsubscribe = subscribe((evt) => {
      if (evt.type === 'biz' && evt.name === 'webhook.retry_config_invalid') {
        captured.push(evt);
      }
    });
  });

  afterEach(() => {
    for (const key of CONFIG_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    unsubscribe();
    _resetWebhookRetryConfigWarned();
  });

  it('defaults to the documented ladder when every knob is unset', () => {
    for (const key of CONFIG_KEYS) delete process.env[key];
    assert.deepEqual(webhookRetryConfig(), {
      maxAttempts: 3,
      baseDelayMs: 30_000,
      factor: 2,
      maxDelayMs: 3_600_000,
    });
    assert.equal(getWebhookMaxAttempts(), 3);
    assert.equal(MAX_WEBHOOK_ATTEMPTS, 3);
  });

  it('honours the tuned ladder on every backoff calculation', () => {
    process.env.WEBHOOK_MAX_ATTEMPTS = '5';
    process.env.WEBHOOK_RETRY_BASE_DELAY_MS = '1000';
    process.env.WEBHOOK_RETRY_FACTOR = '3';
    process.env.WEBHOOK_RETRY_MAX_DELAY_MS = '10000';

    assert.deepEqual(webhookRetryConfig(), {
      maxAttempts: 5,
      baseDelayMs: 1_000,
      factor: 3,
      maxDelayMs: 10_000,
    });
    assert.equal(getWebhookMaxAttempts(), 5);
    // 1000 * 3^0 → 1000, *3^1 → 3000, *3^2 → 9000, then capped at 10_000
    assert.equal(getWebhookRetryDelay(0), 1_000);
    assert.equal(getWebhookRetryDelay(1), 3_000);
    assert.equal(getWebhookRetryDelay(2), 9_000);
    assert.equal(getWebhookRetryDelay(3), 10_000);
    assert.equal(getWebhookRetryDelay(4), 10_000);
    assert.equal(calculateWebhookBackoff(1), 1_000);
    assert.equal(calculateWebhookBackoff(4), 10_000);
  });

  it('allows a fractional factor but never lets it collapse below 1', () => {
    process.env.WEBHOOK_RETRY_FACTOR = '1.5';
    assert.equal(webhookRetryConfig().factor, 1.5);
    assert.equal(getWebhookRetryDelay(0), 30_000);
    assert.equal(getWebhookRetryDelay(1), 45_000);

    process.env.WEBHOOK_RETRY_FACTOR = '0.5'; // out of [1,10] → default 2
    assert.equal(webhookRetryConfig().factor, 2);
  });

  it('falls back per-key and emits webhook.retry_config_invalid on a corrupt value', () => {
    process.env.WEBHOOK_MAX_ATTEMPTS = 'bogus';
    assert.equal(getWebhookMaxAttempts(), 3);
    assert.equal(webhookRetryConfig().maxAttempts, 3);

    const [warning] = captured;
    assert.ok(warning, 'expected one webhook.retry_config_invalid warning');
    assert.equal(warning.fields.key, 'WEBHOOK_MAX_ATTEMPTS');
    assert.equal(warning.fields.raw_value, 'bogus');
  });

  it('rejects out-of-range and fractional configs everywhere, always the default ladder', () => {
    for (const bad of ['0', '51', '-1', '2.5', '999999999999999999999999']) {
      process.env.WEBHOOK_MAX_ATTEMPTS = bad;
      assert.equal(getWebhookMaxAttempts(), 3, `WEBHOOK_MAX_ATTEMPTS=${bad}`);
    }
    for (const bad of ['0', '-5000', 'abc', '3600001']) {
      process.env.WEBHOOK_RETRY_BASE_DELAY_MS = bad;
      assert.equal(webhookRetryConfig().baseDelayMs, 30_000, `WEBHOOK_RETRY_BASE_DELAY_MS=${bad}`);
    }
    for (const bad of ['0', '0.999', '11', 'abc']) {
      process.env.WEBHOOK_RETRY_FACTOR = bad;
      assert.equal(webhookRetryConfig().factor, 2, `WEBHOOK_RETRY_FACTOR=${bad}`);
    }
    for (const bad of ['0', '-1', '86400001', 'abc']) {
      process.env.WEBHOOK_RETRY_MAX_DELAY_MS = bad;
      assert.equal(webhookRetryConfig().maxDelayMs, 3_600_000, `WEBHOOK_RETRY_MAX_DELAY_MS=${bad}`);
    }
    // The default ladder is what the backoff actually runs
    assert.equal(calculateWebhookBackoff(2), 60_000);
  });

  it('the config warning fires exactly once across all four keys', () => {
    process.env.WEBHOOK_MAX_ATTEMPTS = 'bogus';
    process.env.WEBHOOK_RETRY_BASE_DELAY_MS = 'bogus';
    process.env.WEBHOOK_RETRY_FACTOR = 'bogus';
    process.env.WEBHOOK_RETRY_MAX_DELAY_MS = 'bogus';

    webhookRetryConfig();
    webhookRetryConfig();
    calculateWebhookBackoff(1);
    getWebhookMaxAttempts();

    assert.equal(captured.length, 1, 'a misconfigured env must warn once, not on every read');
    assert.equal(captured[0].fields.key, 'WEBHOOK_MAX_ATTEMPTS');
  });

  it('treats an empty string as unset (falls back silently, no warning)', () => {
    process.env.WEBHOOK_MAX_ATTEMPTS = '';
    process.env.WEBHOOK_RETRY_BASE_DELAY_MS = '';
    assert.equal(getWebhookMaxAttempts(), 3);
    assert.equal(webhookRetryConfig().baseDelayMs, 30_000);
    assert.equal(captured.length, 0);
  });
});
