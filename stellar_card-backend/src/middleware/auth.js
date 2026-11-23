// @ts-check
// Shared API key authentication middleware for /v1 routes.
// Uses key_prefix for O(1) candidate lookup, then bcrypt for verification.
//
// Two key formats are accepted:
//   v2 (new):    sk_{live|test}_{32 random hex}{6 hex CRC32 checksum}  (46 chars)
//   v1 (legacy): stellar_card_{48 random hex chars}                     (57 chars)
//
// v2 keys are validated for format AND CRC32 checksum before the DB is
// touched; a corrupted or mistyped key is rejected immediately with no
// bcrypt work and no SQL — O(1) early exit at negligible CPU cost.

const bcrypt = require('bcryptjs');
const db = require('../db');
const { validateApiKeyFormat } = require('../lib/api-key');
const { verifyCredential } = require('../mpp/credential');

// Legacy v1 format constants (unchanged).
const LEGACY_PREFIX = 'stellar_card_';
const LEGACY_KEY_MIN_LENGTH = 21; // stellar_card_ (13) + 12-char prefix minimum
const LEGACY_KEY_MAX_LENGTH = 128;

// v2 key is exactly: sk_live_ (8) + 32 payload + 6 checksum = 46 chars.
// Allow ±2 for future format revisions but reject anything obviously wrong.
const V2_KEY_LENGTH = 46;

// Cap on candidate rows per auth attempt. The prefix is 12 hex chars =
// 48 bits of entropy, so accidental collisions are effectively zero; a
// legit key always matches the first (and only) row in its prefix
// bucket. The cap exists purely to bound the DoS amplifier from the
// `OR key_prefix IS NULL` legacy fallback: without a LIMIT, every
// malformed-key request bcrypts against every legacy NULL-prefix row
// in the DB. At cost 10 that's ~60ms per row, linear in legacy count.
// 20 rows × 60ms ≈ 1.2s is a tolerable upper bound for the very
// unusual legacy-install case and still lets any real match through.
// Adversarial audit F1-auth.
const MAX_AUTH_CANDIDATES = 20;

// One-time startup check: log the count of legacy NULL-prefix rows so
// operators can decide whether to migrate them. Without this, a legacy
// install silently runs with the full-table fallback enabled and the
// operator has no way to see it. Wrapped in try/catch so a fresh
// install (pre-migration) doesn't crash the module.
try {
  const legacyCount = /** @type {any} */ (
    db.prepare(`SELECT COUNT(*) AS n FROM api_keys WHERE key_prefix IS NULL`).get()
  )?.n;
  if (legacyCount > 0) {
    console.warn(
      `[auth] ${legacyCount} legacy api_keys rows have NULL key_prefix — ` +
        `these participate in every auth attempt via the fallback query. ` +
        `Migrate them by setting key_prefix = substr(key, 10, 12) after verifying the raw key, ` +
        `or retire the rows if they're no longer valid.`,
    );
  }
} catch (_) {
  /* table doesn't exist yet — module load during fresh-install migration */
}

/**
 * Extract an MPP credential token from the request, if present.
 *
 * Accepted locations (checked in order):
 *   - `Authorization: Bearer <jwt>`  (only when the value looks like a JWT)
 *   - `X-MPP-Credential: <jwt>`
 *
 * Returns the raw token string, or null when the request carries no MPP
 * credential. A malformed `Authorization` header that is not a Bearer JWT
 * is ignored here so the API-key path can still run.
 *
 * @param {import('express').Request} req
 * @returns {string | null}
 */
function extractMppCredential(req) {
  const header = req.headers['x-mpp-credential'];
  if (typeof header === 'string' && header.trim()) return header.trim();

  const authz = req.headers['authorization'];
  if (typeof authz === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authz.trim());
    if (match) {
      const token = match[1].trim();
      // Only treat it as an MPP credential when it looks like a JWT
      // (three dot-separated segments). Anything else falls through to
      // the API-key path untouched.
      if (token.split('.').length === 3) return token;
    }
  }
  return null;
}

/**
 * Build a synthetic apiKey-shaped object from verified MPP credential
 * claims so downstream handlers (which expect `req.apiKey`) keep working.
 *
 * @param {any} claims
 */
function syntheticApiKeyFromClaims(claims) {
  const scope = claims && typeof claims.scope === 'object' && claims.scope !== null ? claims.scope : {};
  return {
    id: null,
    agent_id: claims.agent_id ?? null,
    name: claims.agent_id ?? 'mpp-credential',
    key_prefix: 'mpp',
    enabled: 1,
    suspended: 0,
    expires_at: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
    scope,
    source: 'mpp_credential',
  };
}

module.exports = async function auth(req, res, next) {
  // ── MPP credential path ─────────────────────────────────────────────────
  //
  // If the request carries an MPP credential token, validate it before
  // touching the API-key flow. A present-but-invalid token is rejected
  // outright (we do not silently fall back to API-key auth) so callers
  // get a clear signal that their credential is bad.
  const mppToken = extractMppCredential(req);
  if (mppToken) {
    const result = verifyCredential(mppToken);
    if (!result.valid) {
      if (result.error === 'expired') {
        return res.status(401).json({
          error: 'mpp_credential_expired',
          message: 'MPP credential has expired. Re-verify the challenge to obtain a new one.',
        });
      }
      return res.status(401).json({
        error: 'mpp_credential_invalid',
        message: 'MPP credential is invalid.',
      });
    }
    req.mppCredential = result.claims;
    req.apiKey = syntheticApiKeyFromClaims(result.claims);
    return next();
  }

  const rawKey = req.headers['x-api-key'];
  // Coerce to a single string. Express hands duplicated headers through
  // as either a joined string or (for some header names) an array; reject
  // arrays outright rather than risk `.startsWith` throwing below.
  if (!rawKey) return res.status(401).json({ error: 'missing_api_key' });
  if (typeof rawKey !== 'string') return res.status(401).json({ error: 'invalid_api_key' });
  const key = rawKey;

  // ── Early rejection: format + checksum, no DB work ──────────────────────
  //
  // Determine which format the key claims to be. Any key that doesn't match
  // either known format is rejected immediately — no SQL, no bcrypt.
  //
  // For v2 keys (sk_live_ / sk_test_) we also verify the CRC32 checksum
  // here. A corrupted or mistyped key with the right prefix but a wrong
  // checksum is rejected in O(1) time before the DB is opened.
  let keyPrefix;

  if (key.startsWith('sk_live_') || key.startsWith('sk_test_')) {
    // v2 format — validate structure and CRC32.
    const result = validateApiKeyFormat(key);
    if (!result.valid) {
      return res.status(401).json({ error: 'invalid_api_key' });
    }
    keyPrefix = result.prefix;
  } else if (key.startsWith(LEGACY_PREFIX)) {
    // v1 legacy format — length guard only, no checksum.
    if (key.length < LEGACY_KEY_MIN_LENGTH || key.length > LEGACY_KEY_MAX_LENGTH) {
      return res.status(401).json({ error: 'invalid_api_key' });
    }
    keyPrefix = key.slice(13, 25); // stellar_card_ is 13 chars; take next 12
  } else {
    return res.status(401).json({ error: 'invalid_api_key' });
  }

  // Use the prefix index to narrow candidates. The `key_prefix IS NULL`
  // fallback catches any legacy rows created before the column existed
  // (very old installs); it's typically zero extra rows on modern DBs.
  // LIMIT MAX_AUTH_CANDIDATES bounds the DoS amplifier — see the
  // constant's comment for the rationale.
  const candidates = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT * FROM api_keys
         WHERE enabled = 1 AND (key_prefix = ? OR key_prefix IS NULL)
         LIMIT ?`,
      )
      .all(keyPrefix, MAX_AUTH_CANDIDATES)
  );

  for (const candidate of candidates) {
    let matched = false;
    try {
      matched = await bcrypt.compare(key, candidate.key_hash);
    } catch (err) {
      // A corrupted key_hash (malformed bcrypt string) would otherwise
      // throw all the way out through the async middleware and 500 the
      // request — effectively locking the whole endpoint for anyone who
      // happens to share a prefix with the bad row. Swallow and skip.
      console.warn(
        `[auth] bcrypt.compare threw on api_key_id=${candidate.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (!matched) continue;

    // Post-match gates. Each returns a specific error so legitimate key
    // holders can tell the difference between "your key is wrong" and
    // "your key is suspended / expired" — someone without the key can
    // never reach these branches at all (bcrypt.compare already proved
    // possession of the raw key).
    //
    // F1-auth (2026-04-15): `new Date('not-a-date') < new Date()` is
    // `NaN < number` → FALSE. A corrupted expires_at row (bad ISO,
    // ops typo, schema drift) silently bypasses the expiry check and
    // lets the key holder continue past what was meant to be a dead
    // expiry. Fail closed: if expires_at is set but unparseable, treat
    // the key as expired AND console.error so ops can fix the row.
    // `api_key_expired` is the right wire verdict — the only way to
    // reach this branch is after bcrypt already proved key possession,
    // so there's no additional info leak over the existing expiry path.
    if (candidate.expires_at) {
      const expiresAtMs = new Date(candidate.expires_at).getTime();
      if (!Number.isFinite(expiresAtMs)) {
        console.error(
          `[auth] api_keys.id=${candidate.id} has unparseable expires_at=${JSON.stringify(
            candidate.expires_at,
          )} — failing closed as expired. Ops: fix the row.`,
        );
        return res
          .status(401)
          .json({ error: 'api_key_expired', message: 'This API key has expired.' });
      }
      if (expiresAtMs < Date.now()) {
        return res
          .status(401)
          .json({ error: 'api_key_expired', message: 'This API key has expired.' });
      }
    }
    if (candidate.suspended) {
      // Suspended was previously only enforced at order-creation time
      // via src/policy.js:37. Every read endpoint (GET /v1/orders/:id,
      // GET /v1/usage, /v1/orders list, etc.) let suspended agents
      // straight through. Blocking at auth is the right place — one
      // gate, covers every /v1/* route.
      return res.status(401).json({
        error: 'api_key_suspended',
        message: 'This API key has been suspended by the operator.',
      });
    }

    req.apiKey = candidate;
    // F2-auth (2026-04-15): track last-seen for agent connection status,
    // but truly fire-and-forget. better-sqlite3 `.run()` throws on any
    // write failure (database locked, disk full, WAL checkpoint collision,
    // corrupt journal, SQLITE_BUSY during a backup). Pre-fix, that throw
    // escaped the async middleware and 500'd a request whose auth had
    // ALREADY succeeded — turning a transient maintenance blip into a
    // hard failure for every agent hitting /v1/* until the write cleared.
    // A missed last_used_at timestamp is cosmetic (dashboard agent-connection
    // status falls a few seconds stale); a 500 on a good request is not.
    try {
      db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).run(
        candidate.id,
      );
    } catch (err) {
      console.warn(
        `[auth] last_used_at update failed for api_key_id=${candidate.id}: ${
          err instanceof Error ? err.message : String(err)
        } — auth still succeeds`,
      );
    }
    return next();
  }

  return res.status(401).json({ error: 'invalid_api_key' });
};
