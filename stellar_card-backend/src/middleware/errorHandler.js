// @ts-check
// Standardized global error handler middleware.
// Centralizes error formatting, logging, and metric emission to ensure
// all unhandled Express exceptions and rejected AppError instances
// produce a structured `request.error` bizEvent and a safe HTTP error
// response.
//
// AppError instances (src/lib/app-error.js) carry a statusCode and
// errorCode that are reflected in the response. All other unhandled
// errors fall back to a generic 500 / internal_error response.
//
// CORS errors are handled by an earlier inline middleware in app.js
// and never reach this handler.

const { event: bizEvent } = require('../lib/logger');
const { formatRejection } = require('../lib/process-handlers');
const { AppError } = require('../lib/app-error');

/**
 * Express error handling middleware.
 * Must be mounted last in the app middleware chain.
 *
 * @param {any} err - The unhandled error, AppError, or thrown rejection.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
function errorHandler(err, req, res, _next) {
  const payload = formatRejection(err);
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

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.errorCode,
      message: err.message,
      req_id: req.id,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Ensure safe fallback response to the client.
  // We explicitly avoid leaking internal stack traces or database errors.
  res.status(500).json({ error: 'internal_error', req_id: req.id });
}

module.exports = errorHandler;
