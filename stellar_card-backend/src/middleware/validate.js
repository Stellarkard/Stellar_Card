// @ts-check
// Generic Zod request-body validation middleware (Issue #27).
//
// Scope note: this codebase's existing POST routes already carry extensive,
// deliberately hand-written validation from a series of "adversarial audit"
// hardening passes (see the F1-orders/F1-auth/F3-orders comments in
// src/api/orders.js and src/api/auth.js). Blanket-replacing that logic with
// generic schemas risks silently dropping a hardening property that isn't
// obvious from the schema alone (e.g. the duplicate-header array check on
// Idempotency-Key, or the max-2-decimal-places amount regex). This
// middleware is applied to POST /auth/login as a concrete, verified
// example — its existing checks are simple enough to translate to a Zod
// schema while keeping test/integration/auth-verify.test.js's "F1 body
// shape guard" tests passing unmodified. Rolling this out to the
// higher-stakes endpoints (orders, dashboard, vcc-callback) is follow-up
// work that deserves its own review, not a rushed blanket pass.

/**
 * Returns Express middleware that validates `req.body` against `schema`.
 *
 * Two distinct failure modes, matching this codebase's existing
 * `invalid_request` (malformed body shape) vs. field-specific error code
 * convention:
 *
 *   - body missing / not a JSON object / an array → `bodyErrorCode`
 *     (default `invalid_request`)
 *   - body is an object but fails `schema` → `fieldErrorCode`
 *
 * On success, `req.body` is replaced with the parsed (and any
 * Zod-transformed/defaulted) value.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {{ bodyErrorCode?: string, bodyErrorMessage?: string, fieldErrorCode?: string }} [options]
 */
function validateBody(schema, options = {}) {
  const bodyErrorCode = options.bodyErrorCode ?? 'invalid_request';
  const bodyErrorMessage =
    options.bodyErrorMessage ??
    'Request body must be a JSON object (set Content-Type: application/json).';
  const fieldErrorCode = options.fieldErrorCode ?? 'invalid_request';

  return (/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: bodyErrorCode, message: bodyErrorMessage });
    }

    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues[0]?.message || 'Invalid request body.';
      return res.status(400).json({ error: fieldErrorCode, message });
    }

    req.body = result.data;
    return next();
  };
}

module.exports = { validateBody };
