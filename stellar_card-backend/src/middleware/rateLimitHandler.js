// @ts-check

/**
 * Build the shared JSON responder used when an API rate limit is exceeded.
 *
 * @param {string} message
 * @returns {import('express').RequestHandler}
 */
function rateLimitHandler(message) {
  return (req, res) =>
    res.status(429).json({
      error: 'too_many_requests',
      message,
      req_id: req.id,
    });
}

module.exports = rateLimitHandler;
