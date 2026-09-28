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
const { StrKey } = require('@stellar/stellar-sdk');

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
 * `minLength` is for fields that are both bounded and required: a
 * present-but-empty value is the same operational problem as a missing
 * one, so it reuses `typeMessage` rather than inventing a third string
 * the caller would have to keep in sync.
 *
 * The declared return type is a Zod schema whose *output* is a string.
 * That is true at runtime — every branch that does not add an issue has
 * already checked `typeof value === 'string'` — but Zod cannot infer it
 * from `z.unknown().superRefine(...)`, whose output it types as `unknown`.
 * Without the annotation every consumer has to cast, and the casts are
 * invisible to review; with it, `tsc` catches a genuinely mistyped field.
 *
 * @param {number} maxLength
 * @param {string} typeMessage
 * @param {string} lengthMessage
 * @param {{ minLength?: number }} [options]
 * @returns {import('zod').ZodType<string, import('zod').ZodTypeDef, string>}
 */
function boundedString(maxLength, typeMessage, lengthMessage, options = {}) {
  const minLength = options.minLength || 0;
  return /** @type {import('zod').ZodType<string, import('zod').ZodTypeDef, string>} */ (
    z.unknown().superRefine((value, ctx) => {
      if (typeof value !== 'string') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: typeMessage });
        return;
      }
      if (value.length > maxLength) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: lengthMessage });
        return;
      }
      if (value.length < minLength) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: typeMessage });
      }
    })
  );
}

/**
 * A Stellar ed25519 public key, checksum-enforced.
 *
 * The bare `^G[A-Z2-7]{55}$` shape check was retired from agent/status
 * after the 2026-04-15 audit: it accepted any 56-char base32 string,
 * including one with a wrong Ed25519 checksum. That stored silently and
 * later blew up in the xlm-sender or Horizon's account loader. StrKey is
 * the same check the rest of the Stellar pipeline uses, so a value that
 * passes here is a value the SDK will accept downstream.
 *
 * Non-strings, null and undefined all fail unless the caller opts in via
 * `.nullable().optional()` (agent/status lets `null` mean "clear it").
 *
 * @param {string} message
 */
function stellarPublicKey(message) {
  return z.unknown().superRefine((value, ctx) => {
    if (typeof value !== 'string' || !StrKey.isValidEd25519PublicKey(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
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

/**
 * `req.params.id` for the order read endpoints.
 *
 * Express merges params from every matching layer and decodeURIComponent's
 * them, so `req.params.id` is never a raw URL segment — but it IS
 * unbounded. A 10 MB `GET /v1/orders/<id>` path parameter is a real (if
 * cheap) DoS vector: the value is bound, copied and compared before the
 * query is even prepared. Bounding the length at the edge means the
 * handler only ever sees a string of a sane size, and the rejection is a
 * deliberate 400 rather than an accidental miss.
 *
 * Length-only rather than a UUID/ULID pattern, because `orders.id` is
 * generated by whichever branch created the row (uuid v4 on the create
 * path, a VCC-supplied id on the callback path) and is NOT guaranteed to
 * be one specific shape. A pattern here would 400 on ids that are perfectly
 * valid rows, turning a schema change into a self-inflicted outage.
 *
 * @param {string} label route parameter name, for the error message
 */
function orderIdParam(label = 'id') {
  return z.string().min(1).max(256, `${label} is too long`);
}

// Per-field caps for the sealed-card payload. The vault does not know how
// long a PAN or a brand string should be, so these are the only thing
// standing between an oversized VCC field and a blob sealed verbatim into
// card storage. Every cap is a generous multiple of the real maximum.
const CARD_NUMBER_MAX = 32;
const CARD_CVV_MAX = 8;
const CARD_EXPIRY_MAX = 16;
const CARD_BRAND_MAX = 128;

/**
 * The card payload VCC posts to `POST /vcc-callback` when a job succeeds.
 *
 * Lives here rather than inline in vcc-callback.js so the callback and
 * anything else that has to reason about a fulfillment payload agree on
 * one definition — including the length bounds, which the original inline
 * schema had no notion of at all.
 *
 * The required-field messages are byte-identical to the ones vcc-callback
 * returned before, because they are part of the response contract. This is
 * a single exported schema rather than a factory taking messages because
 * there is exactly one consumer today; the second one should decide
 * whether per-route wording is worth a parameter, not the first.
 */
const FulfillmentCard = z.object({
  number: boundedString(CARD_NUMBER_MAX, 'card.number is required', 'card.number is too long', {
    minLength: 1,
  }),
  cvv: boundedString(CARD_CVV_MAX, 'card.cvv is required', 'card.cvv is too long', {
    minLength: 1,
  }),
  expiry: boundedString(CARD_EXPIRY_MAX, 'card.expiry is required', 'card.expiry is too long', {
    minLength: 1,
  }),
  // `.optional()` rather than relying on `z.unknown()`'s implied
  // optionality: boundedString wraps unknown() in a refinement, and a
  // ZodEffects field is not treated as an optional key by z.object, so an
  // absent brand would otherwise be rejected as a non-string. Matches
  // z.string().optional() on the schema this replaced — absent passes,
  // an explicit null does not.
  brand: boundedString(
    CARD_BRAND_MAX,
    'card.brand must be a string',
    'card.brand is too long',
  ).optional(),
});

module.exports = {
  validate,
  patternString,
  boundedString,
  stellarPublicKey,
  jsonObject,
  boundedIntQuery,
  optionalIsoTimestamp,
  orderIdParam,
  FulfillmentCard,
  NON_OBJECT_BODY_MESSAGE,
};
