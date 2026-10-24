// @ts-check
// JSON 404 for unmatched routes.
//
// Express's built-in fallback is an HTML error page, which is
// inconsistent with every other response this API returns and
// unparsable by an SDK expecting JSON. A client that typos a path —
// `GET /v1/order` instead of `/v1/orders` — currently gets back
// `text/html` with a stack-trace-free "Cannot GET /v1/order" body and
// a generic 500-flavored shape, so the SDK surfaces a parse error rather
// than the fact that the route does not exist.
//
// Extracted from app.js (issue #377). It is plain (2-argument) middleware,
// so Express only runs it when no earlier layer handled the request —
// which is precisely the 404 case, provided it is registered after every
// route. Keeping it in its own module makes that ordering requirement
// obvious at the mount site instead of buried in a 500-line app.js.

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function notFound(req, res) {
  res.status(404).json({ error: 'not_found', message: `No route for ${req.method} ${req.path}` });
}

module.exports = notFound;
