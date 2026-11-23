// @ts-check
// MPP challenge lifecycle: create, load, atomic redeem.
//
// A challenge is the short-lived pre-order row that pairs a public
// GET /v1/cards/:product/:amount request with the Stellar tx that
// will eventually pay for it. Bounded TTL (default 10m) and nightly
// sweep in jobs.js keep the table from growing under unauthenticated
// traffic.

const crypto = require('crypto');
const { z } = require('zod');
const db = require('../db');
const { bizEvent } = require('../lib/logger');

const CHALLENGE_ID_PREFIX = 'mpp_c_';
const RECEIPT_ID_PREFIX = 'mpp_r_';

// Default challenge lifetime: 15 minutes. Overridable via env for tests
// and for operators who need a tighter window under abuse.
const DEFAULT_CHALLENGE_TTL_MS = 15 * 60 * 1000;
const CHALLENGE_TTL_MS = (() => {
  const raw = Number(process.env.MPP_CHALLENGE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CHALLENGE_TTL_MS;
})();

// In-memory index of live challenges: id → { createdAt, expiresAt }.
// Mirrors the DB rows so the cleanup worker and verification path can
// answer "is this still alive?" without a round-trip. Entries are
// removed on purge; redeemed rows are dropped from the index too.
/** @type {Map<string, { createdAt: number, expiresAt: number }>} */
const activeChallenges = new Map();
=======

// ── Request validation ───────────────────────────────────────────────────
// Rejects malformed challenge requests before any row is written. Error
// codes are part of the public contract and must not change.
const AMOUNT_RE = /^\d+(?:\.\d{1,2})?$/;
const MIN_AMOUNT = 0.01;
const MAX_AMOUNT = 10_000.0;

const CHALLENGE_ERROR_MESSAGES = Object.freeze({
  invalid_amount: 'Amount must be a decimal like "10" or "10.00" with up to 2 decimal places.',
  amount_out_of_bounds: `Amount must be between ${MIN_AMOUNT} and ${MAX_AMOUNT} USDC.`,
});

const ChallengeRequestSchema = z.object({
  amount: z
    .string()
    .regex(AMOUNT_RE, 'invalid_amount')
    .refine(
      (s) => {
        const n = parseFloat(s);
        return Number.isFinite(n) && n >= MIN_AMOUNT && n <= MAX_AMOUNT;
      },
      { message: 'amount_out_of_bounds' },
    ),
});

/**
 * Validate the path parameters of GET /v1/cards/visa/:amount.
 * @param {{ amount: unknown }} params
 * @returns {{ ok: true, amount: string } | { ok: false, error: string, message: string }}
 */
function parseChallengeRequest(params) {
  const result = ChallengeRequestSchema.safeParse(params);
  if (result.success) return { ok: true, amount: result.data.amount };
  // Regex failures come first in issue order, so the first issue is the
  // most specific reason.
  const code = result.error.issues[0]?.message ?? 'invalid_amount';
  const error = code in CHALLENGE_ERROR_MESSAGES ? code : 'invalid_amount';
  return { ok: false, error, message: CHALLENGE_ERROR_MESSAGES[error] };
}

/**
 * Generate a new challenge id. 24 bytes of entropy encoded as base32
 * (5 bits per char → 39 chars) gives ample collision resistance for
 * an unauthenticated-write table. Prefix makes the id self-describing
 * and avoids any accidental collision with a raw UUID.
 */
function generateChallengeId() {
  return CHALLENGE_ID_PREFIX + crypto.randomBytes(24).toString('base64url');
}

/**
 * Generate a receipt id with the same entropy shape as challenges.
 * Receipt ids are the stable alias used in the 202+Location flow so
 * clients can poll a short URL instead of the opaque order uuid.
 */
function generateReceiptId() {
  return RECEIPT_ID_PREFIX + crypto.randomBytes(24).toString('base64url');
}

/**
 * @typedef {object} CreateChallengeOpts
 * @property {string} resourcePath - The URL path the client requested.
 * @property {string} amountUsdc - Decimal string, e.g. '10.00'.
 * @property {string|null} amountXlm - Quoted XLM amount at challenge time, or null if unquoted.
 * @property {string|null} clientIp - Source IP for forensic/rate-limit context.
 * @property {number} ttlMs - Milliseconds until expiry.
 */

/**
 * Insert a new challenge row. Returns the challenge record so the caller
 * can shape it into the 402 response body. The XLM quote is snapshotted
 * at creation time — a retry verifies against the snapshotted amount,
 * not a freshly-quoted price (which may have drifted).
 * @param {CreateChallengeOpts} opts
 */
function createChallenge(opts) {
  const id = generateChallengeId();
  const createdAt = new Date();
  const ttlMs =
    Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : CHALLENGE_TTL_MS;
  const expiresAt = new Date(createdAt.getTime() + ttlMs);
  db.prepare(
    `INSERT INTO mpp_challenges
        (id, resource_path, amount_usdc, amount_xlm, client_ip, created_at, expires_at)
     VALUES (@id, @resource_path, @amount_usdc, @amount_xlm, @client_ip, @created_at, @expires_at)`,
  ).run({
    id,
    resource_path: opts.resourcePath,
    amount_usdc: opts.amountUsdc,
    amount_xlm: opts.amountXlm ?? null,
    client_ip: opts.clientIp,
    created_at: createdAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  activeChallenges.set(id, {
    createdAt: createdAt.getTime(),
    expiresAt: expiresAt.getTime(),
  });
  return {
    id,
    resourcePath: opts.resourcePath,
    amountUsdc: opts.amountUsdc,
    amountXlm: opts.amountXlm ?? null,
    createdAt,
    expiresAt,
  };
}

/**
 * Load a challenge by id. Returns null if not found.
 * @param {string} id
 */
function loadChallenge(id) {
  if (typeof id !== 'string' || !id.startsWith(CHALLENGE_ID_PREFIX)) return null;
  const row = /** @type {any} */ (db.prepare(`SELECT * FROM mpp_challenges WHERE id = ?`).get(id));
  return row || null;
}

/**
 * True when the challenge's expires_at is at or before `now`.
 * Accepts either a DB row (snake_case expires_at) or the object shape
 * returned by createChallenge (camelCase expiresAt).
 * @param {{ expires_at?: string|Date, expiresAt?: string|Date }|null|undefined} challenge
 * @param {Date} [now]
 */
function isChallengeExpired(challenge, now = new Date()) {
  if (!challenge) return true;
  const raw = challenge.expires_at ?? challenge.expiresAt;
  if (!raw) return true;
  const ts = raw instanceof Date ? raw.getTime() : Date.parse(raw);
  if (!Number.isFinite(ts)) return true;
  return now.getTime() >= ts;
}

/**
 * Attempt to redeem a challenge with a Stellar tx hash. Atomic CAS so
 * concurrent retries against the same challenge can't double-redeem,
 * and the UNIQUE index on redeemed_tx_hash prevents the same tx from
 * redeeming two different challenges.
 *
 * Returns:
 *   { ok: true }                               — challenge is now redeemed against this tx
 *   { ok: false, reason: 'already_redeemed' }  — someone else won, or we already redeemed with a different tx
 *   { ok: false, reason: 'expired' }           — challenge expired before retry
 *   { ok: false, reason: 'not_found' }
 *   { ok: false, reason: 'tx_already_used' }   — this tx was already used against another challenge
 *
 * @param {{ id: string, txHash: string, orderId: string }} opts
 */
function redeemChallenge(opts) {
  const now = new Date().toISOString();
  // Wrap in a transaction so the existence/expiry check and the UPDATE
  // can't race another request in between.
  return db.transaction(() => {
    const row = /** @type {any} */ (
      db.prepare(`SELECT * FROM mpp_challenges WHERE id = ?`).get(opts.id)
    );
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.redeemed_at) {
      // Idempotent retry: same tx matching the same challenge is fine.
      if (row.redeemed_tx_hash === opts.txHash) return { ok: true, idempotent: true };
      return { ok: false, reason: 'already_redeemed' };
    }
    if (row.expires_at <= now) return { ok: false, reason: 'expired' };

    try {
      const result = db
        .prepare(
          `UPDATE mpp_challenges
             SET redeemed_at = @now,
                 redeemed_tx_hash = @tx_hash,
                 order_id = @order_id
           WHERE id = @id AND redeemed_at IS NULL`,
        )
        .run({ now, tx_hash: opts.txHash, order_id: opts.orderId, id: opts.id });
      if (result.changes === 0) return { ok: false, reason: 'already_redeemed' };
    } catch (err) {
      const e = /** @type {any} */ (err);
      // better-sqlite3 exposes code = 'SQLITE_CONSTRAINT_UNIQUE' on UNIQUE
      // violations; also fall back to the message pattern in case the
      // driver ever changes.
      const msg = e?.message || '';
      if (
        e?.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
        /redeemed_tx_hash|idx_mpp_challenges_tx_hash/.test(msg)
      ) {
        return { ok: false, reason: 'tx_already_used' };
      }
      throw err;
    }
    return { ok: true };
  })();
}

/**
 * Associate a receipt id with a redeemed challenge. Called after the
 * order row is inserted so the receipt endpoint can resolve id → order.
 * @param {{ challengeId: string, receiptId: string }} opts
 */
function attachReceiptId(opts) {
  db.prepare(`UPDATE orders SET mpp_receipt_id = ? WHERE mpp_challenge_id = ?`).run(
    opts.receiptId,
    opts.challengeId,
  );
}

/**
 * Load an order by receipt id. Returns the full orders row or null.
 * @param {string} receiptId
 */
function loadOrderByReceiptId(receiptId) {
  if (typeof receiptId !== 'string' || !receiptId.startsWith(RECEIPT_ID_PREFIX)) return null;
  const row = /** @type {any} */ (
    db.prepare(`SELECT * FROM orders WHERE mpp_receipt_id = ?`).get(receiptId)
  );
  return row || null;
}

/**
 * Sweep expired, never-redeemed challenges older than 24h. Keeps the
 * table bounded under sustained unauthenticated traffic. Redeemed rows
 * are kept forever as an audit trail (small volume; they point at the
 * real orders row).
 */
function sweepExpiredChallenges() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const result = db
    .prepare(`DELETE FROM mpp_challenges WHERE redeemed_at IS NULL AND expires_at < ?`)
    .run(cutoff);
  return { deleted: result.changes };
}

/**
 * Purge every challenge whose expires_at has passed. Unlike the nightly
 * sweep this runs on a short interval and removes rows immediately, so
 * the table never accumulates stale entries between sweeps. Emits an
 * observability metric with the number of rows removed.
 * @param {Date} [now]
 * @returns {{ purged: number }}
 */
function purgeExpiredChallenges(now = new Date()) {
  const nowIso = now.toISOString();
  const result = db
    .prepare(`DELETE FROM mpp_challenges WHERE expires_at < ?`)
    .run(nowIso);
  const purged = result.changes;

  // Drop matching entries from the in-memory index. Anything already
  // past its expiry is dead regardless of whether the DB row survived.
  const nowMs = now.getTime();
  for (const [id, meta] of activeChallenges) {
    if (meta.expiresAt <= nowMs) activeChallenges.delete(id);
  }

  if (purged > 0) {
    bizEvent('mpp.challenge_expired_purged', { count: purged });
  }
  return { purged };
}

// Handle for the singleton cleanup worker so double-start is a no-op.
/** @type {NodeJS.Timeout|null} */
let cleanupTimer = null;

/**
 * Start the background TTL cleanup worker. Runs purgeExpiredChallenges
 * every `intervalMs` (default 60s). The timer is unref'd so it never
 * keeps the process alive on its own. Calling this twice returns the
 * existing stop function rather than scheduling a second timer.
 * @param {number} [intervalMs]
 * @returns {() => void} stop function
 */
function startChallengeCleanupWorker(intervalMs = 60_000) {
  if (cleanupTimer) {
    return stopChallengeCleanupWorker;
  }
  const period = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 60_000;
  cleanupTimer = setInterval(() => {
    try {
      purgeExpiredChallenges();
    } catch (err) {
      bizEvent('mpp.challenge_purge_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, period);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
  return stopChallengeCleanupWorker;
}

/**
 * Stop the cleanup worker if running. Safe to call when not started.
 */
function stopChallengeCleanupWorker() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

module.exports = {
  CHALLENGE_ID_PREFIX,
  RECEIPT_ID_PREFIX,
  CHALLENGE_TTL_MS,
  DEFAULT_CHALLENGE_TTL_MS,
  activeChallenges,
  parseChallengeRequest,
  generateChallengeId,
  generateReceiptId,
  createChallenge,
  loadChallenge,
  isChallengeExpired,
  redeemChallenge,
  attachReceiptId,
  loadOrderByReceiptId,
  sweepExpiredChallenges,
  purgeExpiredChallenges,
  startChallengeCleanupWorker,
  stopChallengeCleanupWorker,
};
