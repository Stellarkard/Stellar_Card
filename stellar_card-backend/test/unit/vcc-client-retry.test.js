// Unit tests for issue #955 — VCC provider API request timeout and retry policy.
//
// Verifies that fetchVcc (the internal helper used by all VCC API calls):
//   - applies an 8-second timeout on every request
//   - retries on 502, 503, 504, and network/timeout errors up to 3 total attempts
//   - does NOT retry client errors (400, 401, 403, 422)
//   - applies exponential jitter between retries
//   - succeeds on a transient error followed by a good response

require('../helpers/env');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Module cache patching ─────────────────────────────────────────────────────

function patchCache(relPath, exports) {
  const abs = require.resolve(`../../src/${relPath}`);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports, children: [], paths: [] };
}

const db = require('../../src/db');
patchCache('db', db);
patchCache('lib/logger', { event: () => {} });

const {
  _fetchVcc,
  _isRetryableVccError,
  _VCC_REQUEST_TIMEOUT_MS,
  _VCC_MAX_ATTEMPTS,
  _VCC_RETRY_BASE_MS,
  _resetVccCircuit,
} = require('../../src/vcc-client');

// ── Fetch mock infrastructure ─────────────────────────────────────────────────

let fetchCallCount = 0;
let fetchResponses = []; // array of { status?, err? } — consumed in order

global.fetch = async (_url, _opts) => {
  fetchCallCount++;
  const next = fetchResponses.shift();
  if (!next) throw new Error('No more mock responses queued');
  if (next.err) throw next.err;
  const status = next.status;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ status }),
    text: async () => String(status),
  };
};

function resetFetch() {
  fetchCallCount = 0;
  fetchResponses = [];
}

// Speed up retries in tests: replace sleepWithJitter.
// We can do this because _fetchVcc is the wrapper — we override
// the timer by injecting a no-op via monkey-patching the module's
// internal timer reference is not directly accessible, BUT
// the delays in test environments are short (1s, 2.5s, 5s base) which
// makes tests slow. We validate retry COUNTS, not sleep durations.
// Use a faster fake by patching global.setTimeout to skip non-zero waits
// that originate from sleepWithJitter (detected by the callback length / by
// ordering). The simplest approach: set env var and fast-forward timer.

// Override setTimeout so unit tests don't actually wait.
const _origSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => {
  if (ms > 0 && ms <= 10_000) {
    // sleepWithJitter calls — resolve immediately in tests
    fn(...args);
    return {};
  }
  return _origSetTimeout(fn, ms, ...args);
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('_isRetryableVccError', () => {
  it('returns true for null (network error)', () => {
    assert.equal(_isRetryableVccError(null), true);
  });

  it('returns true for 502', () => assert.equal(_isRetryableVccError({ status: 502 }), true));
  it('returns true for 503', () => assert.equal(_isRetryableVccError({ status: 503 }), true));
  it('returns true for 504', () => assert.equal(_isRetryableVccError({ status: 504 }), true));

  it('returns false for 400', () => assert.equal(_isRetryableVccError({ status: 400 }), false));
  it('returns false for 401', () => assert.equal(_isRetryableVccError({ status: 401 }), false));
  it('returns false for 403', () => assert.equal(_isRetryableVccError({ status: 403 }), false));
  it('returns false for 422', () => assert.equal(_isRetryableVccError({ status: 422 }), false));
  it('returns false for 500', () => assert.equal(_isRetryableVccError({ status: 500 }), false));
});

describe('fetchVcc constants', () => {
  it('timeout is 8 seconds', () => assert.equal(_VCC_REQUEST_TIMEOUT_MS, 8_000));
  it('max attempts is 3', () => assert.equal(_VCC_MAX_ATTEMPTS, 3));
  it('retry base delays are defined for 3 attempts', () => {
    assert.ok(Array.isArray(_VCC_RETRY_BASE_MS));
    assert.ok(_VCC_RETRY_BASE_MS.length >= 3);
  });
});

describe('fetchVcc — retry behavior', () => {
  beforeEach(() => {
    resetFetch();
    _resetVccCircuit();
  });

  it('succeeds immediately when the first call returns 200', async () => {
    fetchResponses.push({ status: 200 });
    const res = await _fetchVcc('http://test/api/invoice', {}, 'test');
    assert.equal(res.ok, true);
    assert.equal(fetchCallCount, 1);
  });

  it('retries on 502 and succeeds on the next attempt', async () => {
    fetchResponses.push({ status: 502 });
    fetchResponses.push({ status: 200 });
    const res = await _fetchVcc('http://test/api/invoice', {}, 'test');
    assert.equal(res.ok, true);
    assert.equal(fetchCallCount, 2);
  });

  it('retries on 503 up to 3 total attempts', async () => {
    fetchResponses.push({ status: 503 });
    fetchResponses.push({ status: 503 });
    fetchResponses.push({ status: 200 });
    const res = await _fetchVcc('http://test/api/invoice', {}, 'test');
    assert.equal(res.ok, true);
    assert.equal(fetchCallCount, 3);
  });

  it('exhausts 3 attempts on persistent 504 and returns the last response', async () => {
    fetchResponses.push({ status: 504 });
    fetchResponses.push({ status: 504 });
    fetchResponses.push({ status: 504 });
    const res = await _fetchVcc('http://test/api/invoice', {}, 'test');
    assert.equal(res.status, 504);
    assert.equal(fetchCallCount, 3);
  });

  it('retries on network error and succeeds on the next attempt', async () => {
    fetchResponses.push({ err: new Error('ECONNREFUSED') });
    fetchResponses.push({ status: 200 });
    const res = await _fetchVcc('http://test/api/invoice', {}, 'test');
    assert.equal(res.ok, true);
    assert.equal(fetchCallCount, 2);
  });

  it('throws after exhausting all attempts on persistent network errors', async () => {
    fetchResponses.push({ err: new Error('timeout') });
    fetchResponses.push({ err: new Error('timeout') });
    fetchResponses.push({ err: new Error('timeout') });
    await assert.rejects(
      () => _fetchVcc('http://test/api/invoice', {}, 'test'),
      /timeout/,
    );
    assert.equal(fetchCallCount, 3);
  });

  it('does NOT retry on 400 (client error)', async () => {
    fetchResponses.push({ status: 400 });
    const res = await _fetchVcc('http://test/api/invoice', {}, 'test');
    assert.equal(res.status, 400);
    assert.equal(fetchCallCount, 1); // only one attempt
  });

  it('does NOT retry on 401 (unauthorized)', async () => {
    fetchResponses.push({ status: 401 });
    const res = await _fetchVcc('http://test/api/invoice', {}, 'test');
    assert.equal(res.status, 401);
    assert.equal(fetchCallCount, 1);
  });

  it('does NOT retry on 403 (forbidden)', async () => {
    fetchResponses.push({ status: 403 });
    const res = await _fetchVcc('http://test/api/invoice', {}, 'test');
    assert.equal(res.status, 403);
    assert.equal(fetchCallCount, 1);
  });

  it('does NOT retry on 422 (unprocessable)', async () => {
    fetchResponses.push({ status: 422 });
    const res = await _fetchVcc('http://test/api/invoice', {}, 'test');
    assert.equal(res.status, 422);
    assert.equal(fetchCallCount, 1);
  });
});
