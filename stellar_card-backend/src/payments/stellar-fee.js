// @ts-check
// Dynamic Stellar base-fee resolution.
//
// Before a payout transaction is built we ask Horizon's `/fee_stats`
// endpoint what the network has actually been charging for inclusion, so a
// congested ledger (surge pricing) doesn't leave our transaction
// under-priced and stuck in the mempool.
//
// Strategy:
//   - Query `/fee_stats` (5s timeout, matching the DEX probe in
//     xlm-sender.js so a hanging Horizon can't stall a payout).
//   - Derive the fee from the 90th-percentile per-operation fee
//     (`fee_charged.p90`, falling back to `max_fee.p90`), multiplied by a
//     safety margin, then clamped to a hard cap so a malformed or hostile
//     response can never sign away the treasury float.
//   - Warn when that p90 exceeds 10× the protocol baseline fee.
//   - Any failure — HTTP error, timeout, malformed body, missing
//     percentile — degrades to a conservative default base fee. A payout
//     must never be blocked just because fee stats were unavailable.
//
// The pure helpers are exported so the fee math can be exercised without
// touching the network.

const { log } = require('../lib/logger');

// Stellar protocol minimum base fee, in stroops per operation. Doubles as
// the conservative fallback when /fee_stats can't be reached.
const DEFAULT_BASE_FEE = 100;
// Margin applied over the observed p90 so a fee bump between our query and
// ledger close doesn't strand the transaction.
const DEFAULT_SAFETY_MULTIPLIER = 2;
// A p90 above this many × the baseline fee is a surge worth alerting on.
const DEFAULT_SURGE_MULTIPLIER = 10;
// Hard per-transaction ceiling, in stroops (1 XLM). Well above any
// realistic p90, low enough that a corrupt response can't drain funds.
const DEFAULT_MAX_FEE_CAP = 10_000_000;
// Cap the Horizon round-trip, mirroring probeUsdcToXlmPath in xlm-sender.js.
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Horizon base URL for the configured network. Read at call time (not module
 * load) so tests and ops can flip STELLAR_NETWORK without a re-require — the
 * same shape jobs.js uses for its funding poller.
 * @returns {string}
 */
function horizonBase() {
  const network = process.env.STELLAR_NETWORK || 'mainnet';
  return network === 'mainnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';
}

/**
 * Read a positive numeric env override, falling back when it's unset or
 * unusable (non-numeric, zero, negative).
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function envPositiveNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Coerce a fee_stats field to a positive finite number, or null.
 * @param {unknown} value
 * @returns {number|null}
 */
function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Clamp a transaction's operation count to an integer >= 1.
 * @param {unknown} opCount
 * @returns {number}
 */
function clampOpCount(opCount) {
  const n = Number(opCount);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.trunc(n);
}

/**
 * @typedef {Object} FeeDecision
 * @property {number} maxFee    total stroops for the whole transaction
 * @property {number} feePerOp  stroops allocated per operation
 * @property {number} opCount
 * @property {'fee_stats'|'fallback'} source
 * @property {boolean} surge    p90 exceeded the surge threshold
 * @property {number|null} p90  observed 90th-percentile per-op fee
 * @property {number} baseline  protocol baseline fee used for the surge test
 * @property {boolean} capped   the safety cap clipped the computed fee
 * @property {string|null} reason  why we fell back (null on the live path)
 */

/**
 * Per-operation fee at `percentile` from a `/fee_stats` body. Prefers
 * `fee_charged` (what the network actually paid for inclusion) over
 * `max_fee` (what submitters offered), then falls back to the last ledger's
 * base fee. Returns null when nothing usable is present.
 * @param {any} stats
 * @param {string} [percentile]
 * @returns {number|null}
 */
function percentileFeePerOp(stats, percentile = 'p90') {
  if (!stats || typeof stats !== 'object') return null;
  for (const bucket of ['fee_charged', 'max_fee']) {
    const value = toPositiveNumber(stats[bucket]?.[percentile]);
    if (value !== null) return value;
  }
  return toPositiveNumber(stats.last_ledger_base_fee);
}

/**
 * True when the p90 per-op fee exceeds `multiplier` × the baseline fee.
 * A non-positive / non-finite baseline can't surge by definition.
 * @param {number|null} p90
 * @param {number} [baseline]
 * @param {number} [multiplier]
 * @returns {boolean}
 */
function isFeeSurge(p90, baseline = DEFAULT_BASE_FEE, multiplier = DEFAULT_SURGE_MULTIPLIER) {
  if (p90 === null || !Number.isFinite(p90)) return false;
  if (!Number.isFinite(baseline) || baseline <= 0) return false;
  if (!Number.isFinite(multiplier) || multiplier <= 0) return false;
  return p90 > baseline * multiplier;
}

/**
 * The decision used whenever live fee stats are unavailable: the
 * conservative default base fee (env-overridable) multiplied by the
 * operation count.
 * @param {unknown} [opCount]
 * @param {string} [reason]
 * @returns {FeeDecision}
 */
function fallbackFeeDecision(opCount = 1, reason = 'fee_stats_unavailable') {
  const ops = clampOpCount(opCount);
  const feePerOp = Math.ceil(envPositiveNumber('STELLAR_FEE_FALLBACK_BASE_FEE', DEFAULT_BASE_FEE));
  return {
    maxFee: ops * feePerOp,
    feePerOp,
    opCount: ops,
    source: 'fallback',
    surge: false,
    p90: null,
    baseline: DEFAULT_BASE_FEE,
    capped: false,
    reason,
  };
}

/**
 * Turn a `/fee_stats` body into a fee decision. Pure — never throws, never
 * touches the network — and returns the fallback shape when the body has no
 * usable percentile.
 * @param {any} stats
 * @param {{ opCount?: unknown, safetyMultiplier?: unknown, maxFeeCap?: unknown,
 *   surgeMultiplier?: unknown }} [opts]
 * @returns {FeeDecision}
 */
function buildFeeDecision(stats, opts = {}) {
  const ops = clampOpCount(opts.opCount ?? 1);
  const p90 = percentileFeePerOp(stats);
  if (p90 === null) return fallbackFeeDecision(ops, 'no_fee_percentile');

  const safetyMultiplier =
    toPositiveNumber(opts.safetyMultiplier) ??
    envPositiveNumber('STELLAR_FEE_SAFETY_MULTIPLIER', DEFAULT_SAFETY_MULTIPLIER);
  const maxFeeCap =
    toPositiveNumber(opts.maxFeeCap) ??
    envPositiveNumber('STELLAR_MAX_FEE_CAP', DEFAULT_MAX_FEE_CAP);
  const surgeMultiplier =
    toPositiveNumber(opts.surgeMultiplier) ??
    envPositiveNumber('STELLAR_FEE_SURGE_MULTIPLIER', DEFAULT_SURGE_MULTIPLIER);
  const baseline = toPositiveNumber(stats?.last_ledger_base_fee) ?? DEFAULT_BASE_FEE;

  const perOpWithMargin = Math.ceil(p90 * safetyMultiplier);
  const uncapped = perOpWithMargin * ops;
  const maxFee = Math.min(uncapped, maxFeeCap);
  return {
    maxFee,
    feePerOp: Math.ceil(maxFee / ops),
    opCount: ops,
    source: 'fee_stats',
    surge: isFeeSurge(p90, baseline, surgeMultiplier),
    p90,
    baseline,
    capped: maxFee < uncapped,
    reason: null,
  };
}

/**
 * Resolve the max fee (total stroops) for a transaction about to be built,
 * from live Horizon `/fee_stats`.
 *
 * Never throws: every failure path degrades to `fallbackFeeDecision` and
 * logs a warning, so a fee-stats outage can't block a payout.
 *
 * @param {unknown} [opCount] number of operations in the transaction
 * @param {{ log?: (level: string, message: string, fields?: Record<string, unknown>) => void,
 *   fetch?: typeof fetch, horizonUrl?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<FeeDecision>}
 */
async function resolveStellarMaxFee(opCount = 1, opts = {}) {
  const ops = clampOpCount(opCount);
  /** @type {(level: string, message: string, fields?: Record<string, unknown>) => void} */
  const logFn = opts.log || log;
  /** @type {typeof fetch} */
  const doFetch = opts.fetch || fetch;
  const baseUrl = opts.horizonUrl || horizonBase();
  const timeoutMs = toPositiveNumber(opts.timeoutMs) ?? DEFAULT_TIMEOUT_MS;

  try {
    const res = await doFetch(`${baseUrl}/fee_stats`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`fee_stats http ${res.status}`);
    const stats = await res.json();
    const decision = buildFeeDecision(stats, { opCount: ops });

    if (decision.source === 'fallback') {
      logFn('warn', 'stellar.fee_stats_unusable', {
        reason: decision.reason,
        op_count: ops,
        fallback_fee: decision.maxFee,
      });
      return decision;
    }

    if (decision.surge) {
      logFn('warn', 'stellar.fee_surge', {
        p90_fee: decision.p90,
        baseline_fee: decision.baseline,
        surge_multiplier: envPositiveNumber(
          'STELLAR_FEE_SURGE_MULTIPLIER',
          DEFAULT_SURGE_MULTIPLIER,
        ),
        op_count: ops,
        max_fee: decision.maxFee,
      });
    }
    return decision;
  } catch (err) {
    const decision = fallbackFeeDecision(ops, 'fee_stats_error');
    logFn('warn', 'stellar.fee_stats_failed', {
      error: err instanceof Error ? err.message : String(err),
      op_count: ops,
      fallback_fee: decision.maxFee,
    });
    return decision;
  }
}

module.exports = {
  DEFAULT_BASE_FEE,
  DEFAULT_SAFETY_MULTIPLIER,
  DEFAULT_SURGE_MULTIPLIER,
  DEFAULT_MAX_FEE_CAP,
  DEFAULT_TIMEOUT_MS,
  horizonBase,
  percentileFeePerOp,
  isFeeSurge,
  fallbackFeeDecision,
  buildFeeDecision,
  resolveStellarMaxFee,
};
