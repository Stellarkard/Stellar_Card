// Unit tests for stellar-fee.js — dynamic Stellar maxFee resolution from
// Horizon /fee_stats. Covers the pure fee math (percentile selection, the
// 10×-baseline surge test, the safety cap) and the async resolver's
// fall-back behaviour when /fee_stats is slow, broken, or hostile.
//
// The module-local `log` binding is patched so the warning paths can be
// asserted on; global.fetch is mocked so nothing touches the network.

require('../helpers/env');

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Patch the logger BEFORE requiring the module under test — stellar-fee
// destructures `log` at load time.
function patchCache(relPath, exports) {
  const abs = require.resolve(`../../src/${relPath}`);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports, children: [], paths: [] };
}

let capturedLogs = [];
function resetLogs() {
  capturedLogs = [];
}
patchCache('lib/logger', {
  log: (level, message, fields) => capturedLogs.push({ level, message, fields }),
  event: () => {},
});

const {
  DEFAULT_BASE_FEE,
  DEFAULT_MAX_FEE_CAP,
  horizonBase,
  percentileFeePerOp,
  isFeeSurge,
  fallbackFeeDecision,
  buildFeeDecision,
  resolveStellarMaxFee,
} = require('../../src/payments/stellar-fee');

// ── Fetch mock (same shape as xlm-sender.test.js) ────────────────────────────

let fetchCalls = [];
let fetchImpl = null;
const realFetch = global.fetch;

function mockFetch(impl) {
  fetchImpl = impl;
}

global.fetch = async (url, opts) => {
  fetchCalls.push({ url: String(url), opts });
  if (!fetchImpl) throw new Error(`unexpected fetch in test: ${url}`);
  return fetchImpl(String(url), opts);
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// A fee_stats body with a healthy fee_charged.p90 and the protocol base fee.
function feeStats(p90, extra = {}) {
  return { last_ledger_base_fee: '100', fee_charged: { p90: String(p90) }, ...extra };
}

const FEE_ENV_KEYS = [
  'STELLAR_FEE_FALLBACK_BASE_FEE',
  'STELLAR_FEE_SAFETY_MULTIPLIER',
  'STELLAR_FEE_SURGE_MULTIPLIER',
  'STELLAR_MAX_FEE_CAP',
];

describe('stellar-fee', () => {
  beforeEach(() => {
    fetchCalls = [];
    fetchImpl = null;
    resetLogs();
    for (const key of FEE_ENV_KEYS) delete process.env[key];
  });
  afterEach(() => {
    fetchImpl = null;
    for (const key of FEE_ENV_KEYS) delete process.env[key];
  });

  // ── percentileFeePerOp ─────────────────────────────────────────────────────

  describe('percentileFeePerOp', () => {
    it('prefers fee_charged.p90 over max_fee.p90', () => {
      const stats = { fee_charged: { p90: '700' }, max_fee: { p90: '900' } };
      assert.equal(percentileFeePerOp(stats), 700);
    });

    it('falls back to max_fee.p90 when fee_charged.p90 is unusable', () => {
      assert.equal(percentileFeePerOp({ fee_charged: { p90: '0' }, max_fee: { p90: '900' } }), 900);
      assert.equal(percentileFeePerOp({ max_fee: { p90: '900' } }), 900);
    });

    it('falls back to last_ledger_base_fee when no percentile is present', () => {
      assert.equal(percentileFeePerOp({ last_ledger_base_fee: '100' }), 100);
    });

    it('returns null for malformed or empty bodies', () => {
      assert.equal(percentileFeePerOp(null), null);
      assert.equal(percentileFeePerOp({}), null);
      assert.equal(percentileFeePerOp({ fee_charged: { p90: 'free' } }), null);
      assert.equal(percentileFeePerOp({ fee_charged: { p90: '-5' } }), null);
    });
  });

  // ── isFeeSurge ─────────────────────────────────────────────────────────────

  describe('isFeeSurge', () => {
    it('flags a p90 above 10× the baseline', () => {
      assert.equal(isFeeSurge(1001, 100, 10), true);
    });

    it('does not flag the boundary case (exactly 10×)', () => {
      assert.equal(isFeeSurge(1000, 100, 10), false);
    });

    it('never flags a null p90 or a non-positive baseline', () => {
      assert.equal(isFeeSurge(null, 100, 10), false);
      assert.equal(isFeeSurge(5000, 0, 10), false);
    });
  });

  // ── fallbackFeeDecision ────────────────────────────────────────────────────

  describe('fallbackFeeDecision', () => {
    it('uses the conservative default base fee × operation count', () => {
      const decision = fallbackFeeDecision(2);
      assert.equal(decision.maxFee, 2 * DEFAULT_BASE_FEE);
      assert.equal(decision.feePerOp, DEFAULT_BASE_FEE);
      assert.equal(decision.source, 'fallback');
      assert.equal(decision.surge, false);
      assert.equal(decision.p90, null);
      assert.equal(decision.reason, 'fee_stats_unavailable');
    });

    it('honours STELLAR_FEE_FALLBACK_BASE_FEE', () => {
      process.env.STELLAR_FEE_FALLBACK_BASE_FEE = '250';
      const decision = fallbackFeeDecision(2);
      assert.equal(decision.feePerOp, 250);
      assert.equal(decision.maxFee, 500);
    });
  });

  // ── buildFeeDecision ───────────────────────────────────────────────────────

  describe('buildFeeDecision', () => {
    it('drives maxFee from p90 × safety margin', () => {
      const decision = buildFeeDecision(feeStats(500), { opCount: 1 });
      assert.equal(decision.source, 'fee_stats');
      assert.equal(decision.p90, 500);
      assert.equal(decision.maxFee, 1000);
      assert.equal(decision.feePerOp, 1000);
      assert.equal(decision.capped, false);
      assert.equal(decision.surge, false);
      assert.equal(decision.reason, null);
    });

    it('scales with the operation count', () => {
      const decision = buildFeeDecision(feeStats(500), { opCount: 2 });
      assert.equal(decision.opCount, 2);
      assert.equal(decision.maxFee, 2000);
      assert.equal(decision.feePerOp, 1000);
    });

    it('flags a p90 surge (> 10× the baseline)', () => {
      const decision = buildFeeDecision(feeStats(1500), { opCount: 1 });
      assert.equal(decision.surge, true);
      assert.equal(decision.baseline, 100);
      assert.equal(decision.maxFee, 3000);
    });

    it('clamps the fee to the safety cap', () => {
      const decision = buildFeeDecision(feeStats(10_000_000), { opCount: 1 });
      assert.equal(decision.maxFee, DEFAULT_MAX_FEE_CAP);
      assert.equal(decision.capped, true);
    });

    it('respects an explicit maxFeeCap override', () => {
      const decision = buildFeeDecision(feeStats(500), { opCount: 1, maxFeeCap: 800 });
      assert.equal(decision.maxFee, 800);
      assert.equal(decision.capped, true);
    });

    it('degrades to the fallback when no percentile is usable', () => {
      const decision = buildFeeDecision({ last_ledger: '12345' }, { opCount: 3 });
      assert.equal(decision.source, 'fallback');
      assert.equal(decision.reason, 'no_fee_percentile');
      assert.equal(decision.maxFee, 3 * DEFAULT_BASE_FEE);
    });
  });

  // ── resolveStellarMaxFee ───────────────────────────────────────────────────

  describe('resolveStellarMaxFee', () => {
    it('queries /fee_stats and returns a fee_stats decision', async () => {
      mockFetch(() => jsonResponse(feeStats(500)));
      const decision = await resolveStellarMaxFee(1);
      assert.equal(fetchCalls.length, 1);
      assert.equal(fetchCalls[0].url, `${horizonBase()}/fee_stats`);
      assert.ok(fetchCalls[0].opts?.signal instanceof AbortSignal, 'expected an abort signal');
      assert.equal(decision.source, 'fee_stats');
      assert.equal(decision.maxFee, 1000);
      assert.equal(capturedLogs.length, 0, 'healthy fee stats should not warn');
    });

    it('scales maxFee for multi-operation transactions', async () => {
      mockFetch(() => jsonResponse(feeStats(500)));
      const decision = await resolveStellarMaxFee(2);
      assert.equal(decision.opCount, 2);
      assert.equal(decision.maxFee, 2000);
    });

    it('warns when the network fee surges past 10× the baseline', async () => {
      mockFetch(() => jsonResponse(feeStats(2000)));
      const decision = await resolveStellarMaxFee(1);
      assert.equal(decision.surge, true);
      assert.equal(capturedLogs.length, 1);
      assert.equal(capturedLogs[0].level, 'warn');
      assert.equal(capturedLogs[0].message, 'stellar.fee_surge');
      assert.equal(capturedLogs[0].fields.p90_fee, 2000);
      assert.equal(capturedLogs[0].fields.baseline_fee, 100);
    });

    it('honours STELLAR_MAX_FEE_CAP', async () => {
      process.env.STELLAR_MAX_FEE_CAP = '4000';
      mockFetch(() => jsonResponse(feeStats(10_000_000)));
      const decision = await resolveStellarMaxFee(1);
      assert.equal(decision.maxFee, 4000);
      assert.equal(decision.capped, true);
    });

    it('falls back when Horizon returns a non-2xx status', async () => {
      mockFetch(() => jsonResponse({}, 500));
      const decision = await resolveStellarMaxFee(1);
      assert.equal(decision.source, 'fallback');
      assert.equal(decision.maxFee, DEFAULT_BASE_FEE);
      assert.equal(capturedLogs[0].message, 'stellar.fee_stats_failed');
      assert.match(capturedLogs[0].fields.error, /fee_stats http 500/);
    });

    it('falls back when the fetch itself throws (network/timeout)', async () => {
      mockFetch(() => {
        throw new Error('ECONNRESET');
      });
      const decision = await resolveStellarMaxFee(2);
      assert.equal(decision.source, 'fallback');
      assert.equal(decision.maxFee, 2 * DEFAULT_BASE_FEE);
      assert.equal(capturedLogs[0].message, 'stellar.fee_stats_failed');
      assert.equal(capturedLogs[0].fields.error, 'ECONNRESET');
    });

    it('falls back when the body is not valid JSON', async () => {
      mockFetch(() => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token < in JSON');
        },
      }));
      const decision = await resolveStellarMaxFee(1);
      assert.equal(decision.source, 'fallback');
      assert.equal(capturedLogs[0].message, 'stellar.fee_stats_failed');
    });

    it('falls back when the body carries no usable percentile', async () => {
      mockFetch(() => jsonResponse({ last_ledger: '12345' }));
      const decision = await resolveStellarMaxFee(1);
      assert.equal(decision.source, 'fallback');
      assert.equal(decision.reason, 'no_fee_percentile');
      assert.equal(capturedLogs[0].message, 'stellar.fee_stats_unusable');
      assert.equal(capturedLogs[0].fields.reason, 'no_fee_percentile');
    });

    it('never throws, even on a hostile body shape', async () => {
      mockFetch(() => jsonResponse({ fee_charged: { p90: { evil: true } } }));
      const decision = await resolveStellarMaxFee(1);
      assert.equal(decision.source, 'fallback');
      assert.equal(decision.maxFee, DEFAULT_BASE_FEE);
    });

    it('accepts an injected logger and does not touch the module default', async () => {
      const seen = [];
      mockFetch(() => jsonResponse(feeStats(2000)));
      const decision = await resolveStellarMaxFee(1, {
        log: (level, message) => seen.push({ level, message }),
      });
      assert.equal(decision.surge, true);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].message, 'stellar.fee_surge');
      assert.equal(capturedLogs.length, 0);
    });

    it('accepts an injected fetch and horizonUrl', async () => {
      const calls = [];
      const decision = await resolveStellarMaxFee(1, {
        horizonUrl: 'https://horizon.example.test',
        fetch: async (url, opts) => {
          calls.push({ url, opts });
          return jsonResponse(feeStats(500));
        },
      });
      assert.equal(calls[0].url, 'https://horizon.example.test/fee_stats');
      assert.equal(decision.maxFee, 1000);
    });
  });
});

// Restore global fetch when the suite ends.
process.on('exit', () => {
  global.fetch = realFetch;
});
