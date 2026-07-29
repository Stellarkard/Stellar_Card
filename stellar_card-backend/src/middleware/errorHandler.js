// @ts-check
// Standardized global error handler middleware.
// Centralizes error formatting, logging, and metric emission to ensure
// all unhandled Express exceptions and rejected promises produce a
// structured `request.error` bizEvent and a safe HTTP 500 response.

const { event: bizEvent, log } = require('../lib/logger');
const { formatRejection } = require('../lib/process-handlers');

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
  const requestId = req.id || res.getHeader('X-Request-ID');

  // CORS structured denial from the cors() middleware.
  if (err && err.message && err.message.startsWith('CORS:')) {
    return res
      .status(403)
      .json({ error: 'forbidden', message: 'Origin not allowed', req_id: requestId });
  }

  // Use the formatter from process-handlers to handle exotic thrown values safely
  const payload = formatRejection(err);
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
