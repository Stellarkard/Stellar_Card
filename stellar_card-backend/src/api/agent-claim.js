// @ts-check
// POST /v1/agent/claim — unauthenticated one-shot claim redemption.
//
// Mounted at /v1 BEFORE the auth chain. This is the one endpoint on /v1
// that must be reachable without an X-Api-Key header: it is how an agent
// turns a dashboard-minted claim code INTO its api key. See
// routes/index.js for the mount ordering that makes that safe.

const { Router } = require('express');
const { z } = require('zod');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../db');
const { AppError } = require('../lib/app-error');
const { validate, patternString } = require('../lib/validate');
const rateLimitHandler = require('../middleware/rateLimitHandler');

const router = Router();

// ── Request schema ─────────────────────────────────────────────────────────
//
// One field, but it is the one endpoint on /v1 reachable without a
// credential, so the shape guard is the only thing standing between an
// anonymous caller and the redemption transaction. `/\S/` rejects the
// empty string, a whitespace-only code, and every non-string — the last
// of which used to fall through the `typeof` ternary to '' and produce
// the same `missing_code` this schema returns.
//
// The code itself is not pattern-matched beyond "non-empty": it is
// looked up by SHA-256 hash against a UNIQUE column, so an unknown
// format is indistinguishable from an unknown code and both must return
// the same generic 401 rather than leaking which one it was.
const ClaimBody = z.object({ code: patternString(/\S/, 'code is required') }).passthrough();

const validateClaim = validate({
  body: ClaimBody,
  errorCodes: { code: 'missing_code' },
});

// The agent posts a code minted by the dashboard; we return the real
// api_key once, then mark the code used so it can never be redeemed
// again. Heavily rate-limited by IP precisely because it is the one
// endpoint on /v1 that does not require an api key.
const claimLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (/** @type {any} */ req) => ipKeyGenerator(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler('Too many claim attempts. Wait a minute and try again.'),
});
router.post('/agent/claim', claimLimiter, validateClaim, (req, res, next) => {
  const { event: bizEvent } = require('../lib/logger');
  const secretBox = require('../lib/secret-box');
  const { hashClaimCode } = require('../lib/claim-hash');
  const { recordAudit } = require('../lib/audit');
  const code = req.body.code.trim();

  // F1: the DB stores SHA256(code), not the code itself. Hash before
  // lookup so the UNIQUE constraint still matches the mint path.
  const codeHash = hashClaimCode(code);

  // F2: fold the used_at mark and the sealed_payload wipe into a single
  // atomic UPDATE. The previous flow was claim → SELECT → decrypt →
  // separate UPDATE wipe, which meant a crash between mark-used and
  // wipe left the sealed_payload in the DB alongside used_at=set. The
  // wipe's stated intent ("DB dump after redemption can't re-extract
  // the api_key") depended on that window being zero. The UPDATE
  // below returns the pre-wipe sealed_payload via a nested SELECT so
  // we still get the payload to decrypt in memory, but the row itself
  // is mutated to the post-redemption state in one statement.
  //
  // Concurrent callers: better-sqlite3's transaction() wraps this in
  // BEGIN IMMEDIATE, so the second caller blocks on the write lock
  // until the first commits. After commit the second sees used_at set
  // and UPDATE returns changes=0.
  //
  // F1-claim adversarial audit (2026-04-15): decrypt HAS to happen
  // INSIDE the transaction. Previously the flow was:
  //   mark used + wipe payload  (commits)
  //   secretBox.open(payload)   (can throw)
  // If open() threw — missing CARDS402_SECRET_BOX_KEY, corrupt blob,
  // wrong key after rotation, whatever — the claim was already
  // committed as used. The agent's next retry hit 401 invalid_claim
  // and the claim was permanently burned by a transient server
  // misconfiguration. Moving the decrypt inside the transaction
  // means a throw rolls the whole txn back and the claim stays
  // valid. better-sqlite3 transactions are fully sync so the
  // synchronous crypto call slots in cleanly.
  const now = new Date().toISOString();
  const ip = /** @type {any} */ (req).ip || /** @type {any} */ (req).socket?.remoteAddress || null;

  const redeemTx = db.transaction((codeHashArg) => {
    const selectStmt = db.prepare(
      `SELECT api_key_id, sealed_payload FROM agent_claims
       WHERE code = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')`,
    );
    const rowArg = /** @type {any} */ (selectStmt.get(codeHashArg));
    if (!rowArg) return null;
    // Decrypt BEFORE marking used. Any throw here aborts the txn via
    // better-sqlite3's sync rollback semantics so the claim remains
    // valid for retry. Returning a structured error type lets the
    // outer catch map it to a sanitised 500 without exposing internal
    // crypto details to the client.
    let payloadJson;
    try {
      payloadJson = JSON.parse(secretBox.open(rowArg.sealed_payload));
    } catch (decryptErr) {
      const wrapped = /** @type {Error & { claimDecryptFailed?: boolean }} */ (
        new Error(`claim_decrypt_failed: ${/** @type {Error} */ (decryptErr).message}`)
      );
      wrapped.claimDecryptFailed = true;
      throw wrapped;
    }
    const upd = db
      .prepare(
        `UPDATE agent_claims
         SET used_at = @now, claimed_ip = @ip, sealed_payload = ''
         WHERE code = @code AND used_at IS NULL`,
      )
      .run({ code: codeHashArg, now, ip });
    if (upd.changes === 0) return null; // lost the race to another concurrent call
    return { row: rowArg, payload: payloadJson };
  });

  /** @type {{ row: any, payload: any } | null} */
  let redeemResult;
  try {
    redeemResult = redeemTx(codeHash);
  } catch (err) {
    // F1-claim: decrypt failure rolled the txn back. The claim is
    // still valid. Log server-side with detail, return a generic
    // 500 to the client. F2-claim adversarial audit: do NOT echo
    // the env var name ("CARDS402_SECRET_BOX_KEY") back to an
    // unauthenticated caller — that's an info leak.
    if (/** @type {any} */ (err)?.claimDecryptFailed) {
      console.error(
        `[claim] decrypt failed (txn rolled back, claim still valid): ${err instanceof Error ? err.message : String(err)}`,
      );
      bizEvent('agent.claim_decrypt_failed', {
        code_hash_prefix: codeHash.slice(0, 12),
        error: err instanceof Error ? err.message : String(err),
      });
      return next(
        new AppError(
          500,
          'claim_decrypt_failed',
          'Failed to decrypt claim payload. Contact support if this persists.',
        ),
      );
    }
    // Any other unexpected throw inside the txn — rethrow so Express
    // emits a 500 via its default error handler. Shouldn't happen in
    // practice; the only throw path inside the txn is the decrypt.
    throw err;
  }
  if (!redeemResult) {
    // invalid, expired, or already used — same generic 401 for all
    // three buckets so probing can't distinguish them.
    return res.status(401).json({
      error: 'invalid_claim',
      message: 'Claim code is invalid, expired, or already used.',
    });
  }
  const row = redeemResult.row;
  const payload = redeemResult.payload;

  const key = /** @type {any} */ (
    db.prepare(`SELECT id, label, dashboard_id FROM api_keys WHERE id = ?`).get(row.api_key_id)
  );

  // F3: write an audit_log row for the claim redemption. This is the
  // single most forensically important event in the api-key lifecycle
  // (who turned a mint into live credentials, from what IP, when) and
  // was previously only in bizEvent telemetry — invisible to dashboard
  // operators reviewing audit history. Scoped to the api_key's owning
  // dashboard via the join above.
  if (key?.dashboard_id) {
    // F3-claim: coerce user-agent to a single string (same class of
    // `string | string[]` type bug I fixed in api/auth.js — Express
    // may hand an array through for duplicated headers).
    const uaHeader = req.headers?.['user-agent'];
    const userAgent = Array.isArray(uaHeader) ? uaHeader[0] || null : uaHeader || null;
    recordAudit({
      dashboardId: key.dashboard_id,
      actor: { id: null, email: 'agent-claim', role: 'system' },
      action: 'agent.claim_redeemed',
      resourceType: 'agent',
      resourceId: row.api_key_id,
      details: { label: key.label ?? null },
      ip,
      userAgent,
    });
  }

  // Flip the key into 'initializing' state the instant the claim is
  // redeemed, so the dashboard's modal + state pill progress even if the
  // agent's CLI hasn't yet gotten to its own reportStatus call (network
  // lag, CLI crash between claim and wallet creation, etc.).
  db.prepare(
    `UPDATE api_keys
     SET agent_state = 'initializing',
         agent_state_at = @at,
         agent_state_detail = 'claim redeemed'
     WHERE id = @id`,
  ).run({ id: row.api_key_id, at: now });

  // Emit both a generic claim event (for audit) and the typed
  // agent_state event (for the SSE subscribers filtering by type).
  bizEvent('agent.claimed', {
    api_key_id: row.api_key_id,
    label: key?.label ?? null,
    ip,
  });
  const { emit: emitBusEvent } = require('../lib/event-bus');
  emitBusEvent('agent_state', {
    api_key_id: row.api_key_id,
    state: 'initializing',
    wallet_public_key: null,
    detail: 'claim redeemed',
  });

  res.json({
    api_key: payload.api_key,
    webhook_secret: payload.webhook_secret ?? null,
    api_key_id: row.api_key_id,
    label: key?.label ?? null,
    api_url: process.env.PUBLIC_API_BASE_URL || 'https://api.stellar_card.com/v1',
  });
});

module.exports = router;
