// @ts-check
// Structured CORS denial.
//
// The `cors()` middleware signals a rejected origin by calling its
// `origin` callback with an Error rather than by writing a response.
// Express treats that as a normal error, so without a handler the
// request falls through to the generic 500 in middleware/errorHandler.js
// — which tells a browser "the server is broken" when in fact the
// browser sent an Origin this deployment does not allow. It also leaked
// the raw message ("CORS: origin not allowed") through whatever error
// formatter happened to run last.
//
// This is the single place that turns that Error into the documented
// 403 { error: 'forbidden' } body. It was previously duplicated in
// app.js (twice: once as a shim, once inside the inline error handler)
// and inside middleware/errorHandler.js, which is how the two copies
// drifted. errorHandler.js keeps its own check as a defence-in-depth
// fallback for the case where this handler is not mounted.
//
// Mounted BEFORE the Sentry error handler: a disallowed Origin is a
// client-configuration mistake, not a server fault, and paging on-call
// for one would be noise.

/** The marker prefix cors() errors are identified by. */
const CORS_ERROR_PREFIX = 'CORS:';

/**
 * @param {unknown} err
 * @returns {boolean} true when `err` is a CORS origin rejection
 */
function isCorsDenial(err) {
  return Boolean(
    err &&
    typeof err === 'object' &&
    /** @type {any} */ (err).message &&
    typeof (/** @type {any} */ (err).message) === 'string' &&
    /** @type {any} */ (err).message.startsWith(CORS_ERROR_PREFIX),
  );
}

/**
 * Express error-handling middleware (4 args) that converts a CORS origin
 * rejection into a structured 403 and forwards every other error
 * untouched so the rest of the chain still sees it.
 *
 * @param {any} err
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function corsDenial(err, _req, res, next) {
  if (res.headersSent) return next(err);
  if (!isCorsDenial(err)) return next(err);
  return res.status(403).json({ error: 'forbidden', message: 'Origin not allowed' });
}

module.exports = corsDenial;
module.exports.isCorsDenial = isCorsDenial;
module.exports.CORS_ERROR_PREFIX = CORS_ERROR_PREFIX;
