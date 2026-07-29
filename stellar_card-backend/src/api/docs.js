// @ts-check
// GET /api/openapi.json — the machine-readable contract.
// GET /api/docs        — Swagger UI over that same document.
//
// Mounted at the app root, before the auth chain: the whole point of a
// published spec is that a prospective integrator can read it before they
// have a key. Nothing here touches the database, and neither route
// reveals anything an integrator could not learn by making the calls.
//
// The document is rebuilt per request rather than cached at require time.
// It is a few hundred objects and the endpoint is rate limited, so the
// cost is irrelevant, and building fresh means `servers[0].url` reflects
// the host the request actually arrived on — a self-hosted deployment
// reading its own spec gets its own base URL, and Swagger UI's "Try it
// out" targets the right server instead of the one baked in at boot.

const { Router } = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const { buildOpenApiDocument } = require('./openapi');
const rateLimitHandler = require('../middleware/rateLimitHandler');

const router = Router();

// Building the document allocates a fresh object graph per request. That
// is cheap, but not free, and both routes are unauthenticated — so they
// get the same per-IP ceiling as the other public metadata endpoints
// rather than being left as an unmetered allocation target.
const docsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler('API docs rate limit exceeded. Retry in a minute.'),
});

/**
 * Resolve the public base URL for this request.
 *
 * Prefers the explicitly configured value, because that is the URL the
 * deployment actually publishes. Falls back to reconstructing it from the
 * request, honouring `X-Forwarded-Proto` (app.js sets `trust proxy`) so a
 * deployment behind a TLS terminator advertises https rather than the
 * http its origin server sees.
 *
 * @param {import('express').Request} req
 */
function publicBaseUrl(req) {
  if (process.env.CARDS402_BASE_URL) return process.env.CARDS402_BASE_URL;
  return `${req.protocol}://${req.get('host')}`;
}

router.get('/api/openapi.json', docsLimiter, (req, res) => {
  // Explicit charset: some codegen tools sniff the content type and
  // mis-decode multi-byte characters in the descriptions without it.
  res.type('application/json; charset=utf-8');
  res.json(buildOpenApiDocument({ baseUrl: publicBaseUrl(req) }));
});

// Swagger UI ships its own CSS and its bootstrap script inline. The
// app-wide helmet policy sets `script-src 'self'` and `style-src 'self'`,
// which blocks both and renders a blank page — the classic way a docs
// route ships "working" and is discovered broken by the first person who
// opens it.
//
// Rather than loosening the policy for the whole API, re-apply CSP for
// this subtree only. helmet writes the header with res.setHeader, so the
// route-scoped policy replaces the global one for these paths and leaves
// every other response with the strict headers untouched. The relaxation
// is the minimum Swagger UI needs: inline script and style, same-origin
// everything else, and `img-src data:` for the icons it inlines as data
// URIs. No external host is permitted, so the page still works offline
// and cannot be turned into a data exfiltration channel.
const swaggerCsp = helmet.contentSecurityPolicy({
  useDefaults: false,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  },
});

router.use(
  '/api/docs',
  docsLimiter,
  swaggerCsp,
  swaggerUi.serve,
  swaggerUi.setup(null, {
    // `swaggerOptions.url` points the browser at the JSON endpoint instead
    // of embedding a snapshot of the document in the HTML. One source of
    // truth, and the page picks up a spec change without a redeploy of
    // anything else.
    swaggerOptions: { url: '/api/openapi.json', displayRequestDuration: true },
    customSiteTitle: 'Stellar_Card API',
  }),
);

module.exports = router;
