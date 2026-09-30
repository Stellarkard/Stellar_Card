// @ts-check
// Standardized global error handler middleware.
// Centralizes error formatting, logging, and metric emission to ensure
// all unhandled Express exceptions and rejected promises produce a
// structured `request.error` bizEvent and a safe HTTP 500 response.

const { event: bizEvent } = require('../lib/logger');
const { formatRejection } = require('../lib/process-handlers');
const { captureException } = require('../lib/sentry-config');

/**
 * Express error handling middleware.
 * Must be mounted last in the app middleware chain.
 *
 * @param {any} err - The unhandled error or thrown rejection reason.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    return _next(err);
  }

  // CORS structured denial from the cors() middleware.
  if (err && err.message && typeof err.message === 'string' && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: 'forbidden', message: 'Origin not allowed' });
  }

  // Handle explicit 4xx client errors (e.g. body-parser SyntaxError 400 or PayloadTooLargeError 413)
  const status = Number(err?.status || err?.statusCode);
  if (status >= 400 && status < 500) {
    return res.status(status).json({
      error: err?.type || 'bad_request',
      message: err?.message || 'The request could not be processed.',
    });
  }

  // Use the formatter from process-handlers to handle exotic thrown values safely
  const payload = formatRejection(err);

  // Expose stack trace in logs (not client response)
  const logMessage = `[app] unhandled error on ${req.method} ${req.originalUrl || req.path}: ${payload.name}: ${payload.message}${payload.stack ? `\n${payload.stack}` : ''}`;
  console.error(logMessage);

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

  try {
    captureException(err, {
      tags: { req_id: req.id },
      extra: { path: req.originalUrl || req.path, method: req.method },
    });
  } catch {
    /* observability fallback */
  }

  // Ensure safe fallback response to the client.
  // We explicitly avoid leaking internal stack traces or database errors.
  res.status(500).json({ error: 'internal_error', req_id: req.id });
}

module.exports = errorHandler;
