// @ts-check
// Express application — importable without starting the Stellar watcher or jobs.
// index.js is the entry point that wires everything up for production.

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { log } = require('./lib/logger');
const {
  sentryRequestHandler,
  sentryErrorHandler,
  setRequestId: setSentryRequestId,
} = require('./lib/sentry-config');
const { registerRoutes } = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Sentry's request handler must be the very first middleware: it opens
// the per-request scope that every later captureException() attaches
// itself to, and anything mounted above it reports without request
// context. It is a pass-through no-op when SENTRY_DSN is unset, which is
// the case in development and across the whole test suite.
// Issue #29: src/lib/sentry-config.js was fully built (init, request/error
// handler middleware, capture helpers) but never actually wired into the
// app — initSentry() had no caller anywhere in src/, so error tracking was
// silently a no-op in every environment, production included. The request
// handler must be the very first middleware (per Sentry's own docs) so it
// can attach its transaction/scope before anything else runs; the error
// handler must run before (not instead of) the app's own errorHandler so
// Sentry sees every error the same way that handler does. Both are no-ops
// outside production (see sentryRequestHandler/sentryErrorHandler in
// sentry-config.js), so this has no effect on dev/test behavior.
app.use(sentryRequestHandler());

// B-13: Attach a unique request ID to every request for log correlation.
//
// F1-app (2026-04-16): validate client-supplied X-Request-ID shape
// before accepting it. Pre-fix, `String(req.headers['x-request-id'])`
// accepted anything the client sent. Three real problems:
//
//   1. Header injection self-DoS: a client sending
//      `X-Request-ID: foo\r\nBcc: attacker` would hit the
//      `res.setHeader('X-Request-ID', req.id)` call below and trigger
//      Node's ERR_INVALID_CHAR → the middleware throws before any
//      route handler runs. Every request from that client 500s.
//
//   2. Outbound header corruption: req.id is persisted to
//      `orders.request_id` and later passed to vcc-client.getInvoice,
//      which sets it as the `X-Request-ID` header on outbound fetches
//      to vcc.ctx.com. A garbage-shaped id breaks those fetches with
//      cryptic errors that have nothing to do with the real failure.
//
//   3. Forensics trust: log entries with attacker-controlled correlation
//      ids look indistinguishable from server-generated ones. Ops grepping
//      for a real incident can't tell which rows are trustworthy.
//
// Fix: accept a narrow charset (alphanumeric + dash + underscore + dot
// + colon) up to 64 chars. This is permissive enough for UUIDs, RFC 3986
// token characters, OpenTelemetry trace IDs (32 hex), Sentry event IDs,
// and common SDK formats — but rejects every header-breaking character
// (CR, LF, NUL, space, etc.) and bounds the length.
//
// Invalid or missing client header → fall back to a server-generated
// UUID and emit a bizEvent (one per offending IP, dedup'd) so ops
// sees systematic misuse without log spam.
const REQ_ID_SHAPE = /^[A-Za-z0-9._:-]{1,64}$/;
const _reqIdWarnedIps = new Set();

function validateRequestId(raw) {
  // Node joins duplicate headers with ', ' by default for most header
  // names, but defensively handle both string[] and string.
  if (Array.isArray(raw)) raw = raw[0];
  if (typeof raw !== 'string') return null;
  if (!REQ_ID_SHAPE.test(raw)) return null;
  return raw;
}

app.use((req, res, next) => {
  const rawHeader = req.headers['x-request-id'];
  const validated = validateRequestId(rawHeader);
  if (rawHeader !== undefined && validated === null) {
    // Client supplied something but it didn't match the shape. Dedup
    // the warn per remote address so a repeat offender doesn't spam
    // the log. Scoped to req.ip which Express resolves via trust proxy.
    const ip = req.ip || 'unknown';
    if (!_reqIdWarnedIps.has(ip)) {
      _reqIdWarnedIps.add(ip);
      // Lazy-require so the logger cycle is safe; log-module caches
      // its own state.
      try {
        const { event: bizEvent } = require('./lib/logger');
        bizEvent('request.invalid_request_id', {
          ip,
          raw_preview: String(rawHeader).slice(0, 48),
        });
      } catch {
        /* observability must not block the request */
      }
    }
  }
  req.id = validated || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  // Tag the Sentry scope with the same correlation id the structured
  // logs carry, so an event in Sentry can be joined back to the log
  // lines for the request that produced it. No-op when Sentry is off.
  setSentryRequestId(req.id);
  log('info', 'request', { req_id: req.id, method: req.method, path: req.path });
  next();
});

// Test-only: reset the invalid-request-id dedup cache so unit tests
// can observe the first-offender warn path independently. Not part of
// the public contract.
function _resetReqIdWarnState() {
  _reqIdWarnedIps.clear();
}

/** @type {any} */ const helmetMiddleware = helmet;
// helmet defaults are fine for everything except the HSTS header — the
// built-in default is max-age=15552000 (180 days) with no `preload`
// directive, which is too short to qualify for the Chrome HSTS preload
// list. Bump to two years + preload so api.stellar_card.com can be
// submitted to hstspreload.org and every browser refuses plaintext
// even on first visit. frameguard stays at SAMEORIGIN (API JSON
// responses don't need to be embeddable anywhere).
app.use(
  helmetMiddleware({
    hsts: {
      maxAge: 63072000, // 2 years
      includeSubDomains: true,
      preload: true,
    },
  }),
);
app.set('trust proxy', 1);

// Audit A-25: require HTTPS in non-development environments. A misconfigured
// production deploy that terminates plaintext (e.g. behind a load balancer
// forwarding HTTP) would otherwise ship API keys over the wire unencrypted.
// Honors `X-Forwarded-Proto` because `trust proxy` is set above, so a TLS
// terminator in front (Cloudflare, nginx, ALB) works correctly.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto !== 'https') {
      return res.status(426).json({
        error: 'https_required',
        message: 'This endpoint requires HTTPS. Retry over https://',
      });
    }
    next();
  });
}

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// F4-cors: validate each allowlisted origin at boot. A typo like
// "https//stellar_card.com" (missing colon) otherwise silently fails
// closed — the string never matches a real browser origin and ops
// spends time debugging from the browser console instead of seeing
// a loud startup error. Node's URL throws on bad input; we re-check
// that the normalised .origin equals the configured value so
// ambiguous forms (trailing slash, path, query) get rejected too.
// The origin header per RFC 6454 never includes a trailing slash or
// path, so "https://stellar_card.com/" would never match anyway —
// rejecting at boot instead of at request time makes the mistake
// obvious.
for (const entry of allowedOrigins) {
  try {
    const parsed = new URL(entry);
    if (parsed.origin !== entry) {
      console.error(
        `[cors] CORS_ORIGINS entry ${JSON.stringify(entry)} is not a bare origin ` +
          `(browsers never send trailing slashes or paths in Origin headers). ` +
          `Expected: ${JSON.stringify(parsed.origin)}`,
      );
      process.exit(1);
    }
  } catch {
    console.error(
      `[cors] CORS_ORIGINS entry ${JSON.stringify(entry)} is not a valid URL. ` +
        `Generate one like "https://stellar_card.com" (no path, no trailing slash).`,
    );
    process.exit(1);
  }
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('CORS: origin not allowed'));
    },
    // F1-cors: DELETE was missing. Not currently broken because the
    // dashboard proxies through /api/admin-proxy (server-side =
    // CORS-exempt), but any future direct-to-backend client would
    // have every DELETE operation blocked by preflight.
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    // F2-cors: X-Request-ID is read by app.js for log correlation.
    // A cross-origin client that sets it for traceability previously
    // had its preflight rejected because it wasn't in the allowlist.
    allowedHeaders: [
      'Content-Type',
      'X-Api-Key',
      'Authorization',
      'Idempotency-Key',
      'X-Request-ID',
    ],
    // F3-cors: expose X-Request-ID so cross-origin clients can read
    // it from responses. Browsers only expose the CORS safelist
    // (Cache-Control, Content-Language, Content-Type, Expires,
    // Last-Modified, Pragma) by default — without this, an SDK
    // couldn't read the server-assigned request id it needs to
    // correlate a failed call with server logs.
    exposedHeaders: ['X-Request-ID'],
    maxAge: 3600,
  }),
);

// Capture raw body for HMAC signature verification (used by /vcc-callback)
app.use(
  express.json({
    limit: '64kb',
    verify: (/** @type {any} */ req, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
);

// ── Routes ────────────────────────────────────────────────────────────────────
// All route mounts live in src/routes/index.js — see registerRoutes(app) below.

// Structured CORS denial — cors() throws on rejected origins; catch and return clean 403.
// Non-CORS errors are forwarded to the next error handler (sentryErrorHandler then errorHandler)
// so they are reported and responded to by the proper chain.
app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: 'forbidden', message: 'Origin not allowed' });
  }
  next(err);
});
// Every route lives in its own module under api/, and routes/index.js owns
// the mount table. Three of those mounts are order-sensitive (the
// unauthenticated MPP and claim endpoints, and the pre-auth failure limiter)
// and the reasoning is documented there rather than here, so the answer to
// "which paths require an api key" lives in exactly one place.
registerRoutes(app);

// Issue #29: Sentry's error handler must be mounted after all routes but
// before the app's own errorHandler, so it can capture the error and then
// call next(err) to hand off to errorHandler for the actual response —
// see the app.use(sentryRequestHandler()) comment above for why this was
// previously dead code.
app.use(sentryErrorHandler());

// Standardized global error handler
app.use(errorHandler);

module.exports = app;
// Test-only exports for the 2026-04-16 audit hardening. Not part of
// the production surface — consumers should `require('./app')` and
// get the Express app.
module.exports._validateRequestId = validateRequestId;
module.exports._resetReqIdWarnState = _resetReqIdWarnState;
module.exports._REQ_ID_SHAPE = REQ_ID_SHAPE;
