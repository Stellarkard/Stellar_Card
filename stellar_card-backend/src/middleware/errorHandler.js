// @ts-check
// Standardized global error handler middleware.
//
// Centralizes error formatting, logging, and metric emission so that all
// unhandled Express exceptions and rejected promises produce a safe HTTP
// response: a structured `request.error` bizEvent, a lib/logger log line
// (so it carries req_id and reaches Sentry in production), and a body
// that never leaks internals.
//
// This module is the single source of truth for the error path — the
// inline copy that used to live in app.js (and shadowed this module with
// a *different* response shape) is gone. The behaviors that inline copy
// carried are folded in here:
//
//   1. A res.headersSent guard. SSE routes (GET /v1/orders/:id/stream)
//      write headers immediately and stream over time; an error thrown
//      after that point would hit res.status().json() below and throw
//      ERR_HTTP_HEADERS_SENT instead of just closing the response.
//      Express's documented contract for the final error handler is to
//      delegate to the built-in default handler via next(err) once
//      headers are already sent.
//
//   2. 4xx passthrough. express.json()'s body parser throws a
//      SyntaxError with `.status = 400` for malformed JSON and a
//      PayloadTooLargeError with `.status = 413` for bodies over the
//      64kb cap. These are client mistakes and were previously reported
//      as a generic 500 internal_error, which misrepresents the failure.
//
//   3. Correlation with req.id and Sentry reporting. Every other log
//      line in the app goes through lib/logger so it carries req_id and
//      (in production) reaches Sentry; the old inline handler was the
//      one place that only wrote to console.error. lib/logger and
//      sentry-config's captureException are both no-ops outside
//      production, so this has no effect on dev/test behavior.

const { event: bizEvent, log } = require('../lib/logger');
const { formatRejection } = require('../lib/process-handlers');
const { captureException } = require('../lib/sentry-config');

/**
 * Express error handling middleware.
 * Must be mounted last in the app middleware chain.
 *
 * @param {any} err - The unhandled error or thrown rejection reason.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, req, res, next) {
  // Once the response has started, writing again would throw
  // ERR_HTTP_HEADERS_SENT. Delegate to Express's built-in default.
  if (res.headersSent) return next(err);

  // CORS structured denial from the cors() middleware. Kept as defence
  // in depth for the case where corsDenial is not mounted; the body must
  // stay byte-for-byte identical to src/middleware/corsDenial.js, or the
  // fallback silently becomes a second wire contract.
  if (err && err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: 'forbidden', message: 'Origin not allowed' });
  }

  // Only trust an explicit 4xx as a genuine client error — that's the
  // range well-understood upstream middleware (body-parser) uses.
  // Anything outside it still falls through to the generic 500 below.
  const status = Number(err && (err.status || err.statusCode));
  if (status >= 400 && status < 500) {
    return res.status(status).json({
      error: (err && err.type) || 'bad_request',
      message: (err && err.message) || 'The request could not be processed.',
    });
  }

  // Use the formatter from process-handlers to handle exotic thrown values safely
  const payload = formatRejection(err);

  // Expose stack trace in logs (not client response)
  const logMessage = `[app] unhandled error on ${req.method} ${req.originalUrl || req.path}: ${payload.name}: ${payload.message}${payload.stack ? `\n${payload.stack}` : ''}`;
  console.error(logMessage);

  try {
    log('error', 'unhandled_error', {
      req_id: req.id,
      method: req.method,
      path: req.originalUrl || req.path,
      error: payload.message,
    });
  } catch {
    /* logging must never crash the error handler itself */
  }

  try {
    captureException(err instanceof Error ? err : payload.message, {
      tags: { req_id: req.id },
      extra: { path: req.originalUrl || req.path, method: req.method },
    });
  } catch {
    /* reporting must never crash the error handler itself */
  }

  // Emit structured event for observability pipeline
  try {
    bizEvent('request.error', {
      req_id: req.id,
      method: req.method,
      path: req.originalUrl || req.path,
      ...payload,
    });
  } catch {
    /* observability must never crash the error handler itself */
  }

  // Ensure safe fallback response to the client.
  // We explicitly avoid leaking internal stack traces or database errors.
  res.status(500).json({ error: 'internal_error', req_id: req.id });
}

module.exports = errorHandler;
