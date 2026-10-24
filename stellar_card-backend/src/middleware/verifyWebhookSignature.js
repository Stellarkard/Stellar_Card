// @ts-check
// Inbound partner webhook signature verification (issue #591).
//
// Two modes, both fail-closed with 401:
//
//   verifyWebhookSignature({ getSecret })
//     Full HMAC-SHA256 verification of the raw request body against a shared
//     secret (`sha256=<hex>` in X-Webhook-Signature / X-Signature), compared
//     in constant time via lib/hmac.js. For generic partner endpoints.
//
//   verifyWebhookSignature({ precheckOnly: true, canonicalHeader })
//     For routes that run a stronger protocol-specific verifier themselves
//     (vcc-callback's v3 order+nonce-bound HMAC). Accepts the generic header
//     names as aliases of `canonicalHeader` and rejects unsigned requests
//     with 401. It never accepts a request on its own — the route's verifier
//     stays authoritative for format, timestamp and HMAC checks.
//
// Development bypass: only when NODE_ENV === 'development' AND
// WEBHOOK_SIGNATURE_BYPASS === 'true'. Both are required; the flag is ignored
// in test and production. A bypassed request is marked with
// `req.webhookSignatureBypassed = true` and logged loudly.

const { parseSignatureHeader, verifyWebhookBody } = require('../lib/hmac');
const { event: bizEvent } = require('../lib/logger');

const DEFAULT_SIGNATURE_HEADERS = ['x-webhook-signature', 'x-signature'];

/** True only in explicitly-enabled local development. */
function isSignatureBypassEnabled(env = process.env) {
  return env.NODE_ENV === 'development' && env.WEBHOOK_SIGNATURE_BYPASS === 'true';
}

/**
 * @param {import('express').Request} req
 * @param {string[]} names
 * @returns {string | undefined}
 */
function firstHeader(req, names) {
  for (const name of names) {
    const value = req.headers[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * @param {{
 *   getSecret?: (req: import('express').Request) => string | undefined,
 *   headerNames?: string[],
 *   precheckOnly?: boolean,
 *   canonicalHeader?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 * @returns {import('express').RequestHandler}
 */
function verifyWebhookSignature(options = {}) {
  const {
    getSecret = () => process.env.PARTNER_WEBHOOK_SECRET,
    headerNames = DEFAULT_SIGNATURE_HEADERS,
    precheckOnly = false,
    canonicalHeader,
    env = process.env,
  } = options;
  const lookup = canonicalHeader ? [canonicalHeader, ...headerNames] : headerNames;

  return function webhookSignatureMiddleware(req, res, next) {
    if (isSignatureBypassEnabled(env)) {
      /** @type {any} */ (req).webhookSignatureBypassed = true;
      console.warn(
        '[webhook] signature verification BYPASSED (NODE_ENV=development, WEBHOOK_SIGNATURE_BYPASS=true)',
      );
      return next();
    }

    const header = firstHeader(req, lookup);
    if (!header) {
      bizEvent('webhook.rejected', { reason: 'missing_signature', path: req.originalUrl });
      return res.status(401).json({ error: 'missing_signature' });
    }
    if (precheckOnly) {
      // Normalise an alias onto the canonical header so the route's own
      // verifier sees it; the route performs format + HMAC verification and
      // owns its wire error codes (e.g. missing timestamp -> missing_signature).
      if (canonicalHeader && !req.headers[canonicalHeader]) {
        req.headers[canonicalHeader] = header;
      }
      return next();
    }

    if (!parseSignatureHeader(header)) {
      bizEvent('webhook.rejected', { reason: 'malformed_signature', path: req.originalUrl });
      return res.status(401).json({ error: 'invalid_signature' });
    }

    const verdict = verifyWebhookBody({
      secret: getSecret(req),
      rawBody: /** @type {any} */ (req).rawBody,
      signatureHeader: header,
    });
    if (!verdict.ok) {
      bizEvent('webhook.rejected', { reason: verdict.reason, path: req.originalUrl });
      return res.status(401).json({ error: 'invalid_signature' });
    }
    /** @type {any} */ (req).webhookSignatureVerified = true;
    return next();
  };
}

module.exports = {
  verifyWebhookSignature,
  isSignatureBypassEnabled,
  DEFAULT_SIGNATURE_HEADERS,
};
