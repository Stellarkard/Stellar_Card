// @ts-check
// Request input validation middleware, built on Zod.
//
// Why a middleware rather than more hand-written guards:
//
// Every mutating endpoint on this API had grown its own validation
// preamble — 60+ lines at the top of POST /v1/orders alone — and each one
// re-derived the same primitives (is it an object, is it a string, is it
// within a length cap) with slightly different wording and slightly
// different edge-case handling. The guards were correct but they were
// correct independently, which is how POST /auth/login ended up with a
// body-shape check that POST /auth/verify was missing until an
// adversarial audit found it. Declaring the accepted shape once, next to
// the route, makes the contract auditable at a glance and makes it
// impossible to forget a check that the shared schema already performs.
//
// Two constraints shaped the design:
//
//   1. The wire contract must not change. Existing clients (and the
//      integration suite) depend on specific `error` codes —
//      `invalid_amount`, `invalid_webhook_url`, `invalid_email`,
//      `missing_fields` — not a generic `validation_failed`. Zod reports
//      a *path*, so `validate()` takes a path → error-code map and
//      preserves every code the hand-written guards returned.
//
//   2. Validation must not rewrite the request. POST /v1/orders
//      fingerprints the raw request body for idempotency, so a schema
//      that stripped unknown keys would silently change which retries are
//      considered identical. Schemas here therefore validate without
//      transforming: unknown keys pass through, and known keys are
//      declared with `z.unknown()` plus a refinement rather than a
//      coercing type. `query` is the one exception, where coercion is the
//      point.
//
// Not in scope: anything that needs to touch the network or the database.
// The SSRF check on `webhook_url` (a DNS resolution plus a private-range
// test) stays in the route handler — it is a network policy decision, not
// a shape check, and it is async.

const { z } = require('zod');

// The exact message the hand-written body guards returned. Kept verbatim
// so the response contract is byte-identical.
const NON_OBJECT_BODY_MESSAGE =
  'Request body must be a JSON object (set Content-Type: application/json).';

/**
 * Map a Zod issue to the API error code for its field.
 *
 * Zod issue paths are arrays (`['metadata', 'name']` for a nested field).
 * The map is keyed on the first segment, because API error codes are
 * per-field, not per-leaf.
 *
 * @param {import('zod').ZodIssue} issue
 * @param {Record<string, string>} errorCodes
 * @param {string} fallback
 * @returns {string}
 */
function codeForIssue(issue, errorCodes, fallback) {
  const field = issue.path.length > 0 ? String(issue.path[0]) : '';
  return errorCodes[field] || fallback;
}

/**
 * Assign a validated value back onto the request.
 *
 * `req.query` is an accessor on Express's request prototype. Plain
 * assignment happens to work on Express 4, but defining an own property
 * is explicit about shadowing the getter and does not depend on that
 * detail holding.
 *
 * @param {any} req
 * @param {'body'|'query'|'params'} target
 * @param {unknown} value
 */
function assignTarget(req, target, value) {
  Object.defineProperty(req, target, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Build a validation middleware.
 *
 * The first issue Zod reports wins, and Zod reports object issues in
 * schema-declaration order — so declaring fields in the same order the
 * hand-written guards checked them preserves which error a
 * multiply-invalid request receives.
 *
 * @param {{
 *   body?: import('zod').ZodTypeAny,
 *   query?: import('zod').ZodTypeAny,
 *   params?: import('zod').ZodTypeAny,
 *   errorCodes?: Record<string, string>,
 *   defaultErrorCode?: string,
 * }} config
 * @returns {import('express').RequestHandler}
 */
function validate(config) {
  const {
    body: bodySchema,
    query: querySchema,
    params: paramsSchema,
    errorCodes = {},
    defaultErrorCode = 'invalid_request',
  } = config;

  return function validateRequest(req, res, next) {
    if (bodySchema) {
      // A missing Content-Type, an empty body, or `text/plain` all leave
      // `req.body` as undefined, and a JSON array body leaves it as an
      // array. Both used to reach the route's destructuring and surface
      // as a 500. Checked before the schema so the message names the
      // actual problem instead of listing every required field.
      const rawBody = /** @type {any} */ (req).body;
      if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
        return res.status(400).json({ error: 'invalid_request', message: NON_OBJECT_BODY_MESSAGE });
      }
      const result = bodySchema.safeParse(rawBody);
      if (!result.success) {
        const issue = result.error.issues[0];
        return res.status(400).json({
          error: codeForIssue(issue, errorCodes, defaultErrorCode),
          message: issue.message,
        });
      }
      assignTarget(req, 'body', result.data);
    }

    if (querySchema) {
      const result = querySchema.safeParse(/** @type {any} */ (req).query ?? {});
      if (!result.success) {
        const issue = result.error.issues[0];
        return res.status(400).json({
          error: codeForIssue(issue, errorCodes, defaultErrorCode),
          message: issue.message,
        });
      }
      assignTarget(req, 'query', result.data);
    }

    if (paramsSchema) {
      const result = paramsSchema.safeParse(/** @type {any} */ (req).params ?? {});
      if (!result.success) {
        const issue = result.error.issues[0];
        return res.status(400).json({
          error: codeForIssue(issue, errorCodes, defaultErrorCode),
          message: issue.message,
        });
      }
      assignTarget(req, 'params', result.data);
    }

    return next();
  };
}

// ── Shared field primitives ────────────────────────────────────────────────
//
// Each of these takes the message it should emit, because the wording is
// part of the wire contract and belongs next to the route that owns it.

/**
 * A value that must be a string matching a pattern, without being
 * transformed. Built on `z.unknown()` rather than `z.string()` so that a
 * non-string produces the field's own message rather than Zod's generic
 * "Expected string, received number".
 *
 * @param {RegExp} pattern
 * @param {string} message
 * @param {{ trim?: boolean }} [options]
 */
function patternString(pattern, message, options = {}) {
  return z.unknown().superRefine((value, ctx) => {
    const ok = typeof value === 'string' && pattern.test(options.trim ? value.trim() : value);
    if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });
}

/**
 * A string bounded by a maximum length. Emits `typeMessage` for a
 * non-string and `lengthMessage` when the cap is exceeded, matching the
 * two distinct errors the hand-written guards returned.
 *
 * @param {number} maxLength
 * @param {string} typeMessage
 * @param {string} lengthMessage
 */
function boundedString(maxLength, typeMessage, lengthMessage) {
  return z.unknown().superRefine((value, ctx) => {
    if (typeof value !== 'string') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: typeMessage });
      return;
    }
    if (value.length > maxLength) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: lengthMessage });
    }
  });
}

/**
 * A plain JSON object whose serialised form fits within a byte budget.
 *
 * Arrays and `null` are rejected: both are `typeof 'object'` and both
 * would be stored as something the rest of the pipeline cannot read back
 * as a key/value map. The serialisation is attempted here rather than at
 * the storage site so a value containing a circular reference or a
 * throwing `toJSON` fails as a 400 instead of a 500.
 *
 * @param {number} maxBytes
 * @param {string} typeMessage
 * @param {string} serializeMessage
 * @param {string} sizeMessage
 */
function jsonObject(maxBytes, typeMessage, serializeMessage, sizeMessage) {
  return z.unknown().superRefine((value, ctx) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: typeMessage });
      return;
    }
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: serializeMessage });
      return;
    }
    // JSON.stringify returns undefined for values it cannot represent at
    // the top level; treat that the same as a throw.
    if (serialized === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: serializeMessage });
      return;
    }
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: sizeMessage });
    }
  });
}

/**
 * A bounded integer parsed from a query-string value.
 *
 * Query params arrive as strings (or as arrays, when the client repeats
 * the key). Anything unparseable falls back to the default rather than
 * erroring, matching the pre-existing `parseInt(...) || fallback`
 * behaviour that clients already rely on; the clamp is what actually
 * protects the database.
 *
 * @param {{ default: number, min: number, max: number }} bounds
 */
function boundedIntQuery(bounds) {
  return z
    .unknown()
    .optional()
    .transform((value) => {
      const raw = Array.isArray(value) ? value[0] : value;
      if (raw === undefined || raw === null || raw === '') return bounds.default;
      const parsed = parseInt(String(raw), 10);
      if (!Number.isFinite(parsed)) return bounds.default;
      return Math.min(Math.max(parsed, bounds.min), bounds.max);
    });
}

/**
 * An optional ISO-8601 timestamp used as a `>=` filter bound.
 *
 * These values are compared lexically against `created_at` / `updated_at`
 * columns, which only sorts chronologically for well-formed ISO-8601. A
 * malformed value silently matches everything or nothing, which reads to
 * the caller as data loss — so reject it explicitly.
 *
 * @param {string} message
 */
function optionalIsoTimestamp(message) {
  return z
    .unknown()
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined || value === null || value === '') return;
      const raw = Array.isArray(value) ? value[0] : value;
      if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }
    })
    .transform((value) => {
      if (value === undefined || value === null || value === '') return undefined;
      return Array.isArray(value) ? String(value[0]) : String(value);
    });
}

module.exports = {
  validate,
  patternString,
  boundedString,
  jsonObject,
  boundedIntQuery,
  optionalIsoTimestamp,
  NON_OBJECT_BODY_MESSAGE,
};
