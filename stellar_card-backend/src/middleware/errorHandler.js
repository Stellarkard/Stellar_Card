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

const { event: bizEvent, log } = require('../lib/logger');
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
  // formatRejection handles exotic thrown values (strings, null, objects
  // without a stack) safely, so every branch below can read .name/.message.
  const payload = formatRejection(err);
  const requestId = req.id || res.getHeader('X-Request-ID');

  // CORS structured denial from the cors() middleware.
  if (err && err.message && err.message.startsWith('CORS:')) {
    return res
      .status(403)
      .json({ error: 'forbidden', message: 'Origin not allowed', req_id: requestId });
  }

  const rawStatus = Number(err?.statusCode ?? err?.status);
  const status =
    Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
  const isClientError = status < 500;
  const errorCode =
    isClientError && typeof err?.code === 'string' && /^[a-z][a-z0-9_]*$/.test(err.code)
      ? err.code
      : isClientError
        ? 'bad_request'
        : 'internal_error';

  log(status >= 500 ? 'error' : 'warn', 'request failed', {
    req_id: requestId,
    method: req.method,
    path: req.originalUrl || req.path,
    status,
    error: errorCode,
    exception: payload,
  });

  // Emit structured event for observability pipeline
  try {
    bizEvent('request.error', {
      req_id: requestId,
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
  /** @type {{error: string, req_id: unknown, message?: string}} */
  const response = { error: errorCode, req_id: requestId };
  if (isClientError && err?.expose !== false && payload.message) {
    response.message = payload.message;
  }
  res.status(status).json(response);
}

module.exports = errorHandler;
