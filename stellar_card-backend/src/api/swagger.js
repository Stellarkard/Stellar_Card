// @ts-check
// GET /docs.json — the swagger-jsdoc-generated OpenAPI document.
// GET /docs      — Swagger UI over that same document.
//
// Mounted at the app root, before the auth chain, for the same reason as
// the sibling surface in api/docs.js: a prospective integrator has to be
// able to read the contract before they have a key to call it with.
// Neither route touches the database.
//
// ── Why there are two documentation surfaces ──────────────────────────
//
// `/docs.json` + `/docs` publish the document assembled by swagger-jsdoc
// from the `@openapi` blocks that sit next to the handlers
// (src/docs/openapi.js scans src/api/*.js). `/api/openapi.json` +
// `/api/docs` publish the hand-authored document in src/api/openapi.js,
// which carries the exclusion list that
// test/integration/openapi.test.js checks the router against.
//
// The two arrived from different directions and both have callers and
// tests, so both are served. Consolidating them is a separate change
// with its own review; see docs/API_DOCUMENTATION.md.
//
// ── Why serveFiles/generateHTML rather than serve/setup ───────────────
//
// swagger-ui-express keeps the generated `swagger-ui-init.js` body in a
// module-level variable: `setup()` writes it and the shared `serve`
// middleware reads it back. That is fine for one mount and silently
// wrong for two — whichever `setup()` call ran last wins for *every*
// mount, so this router and api/docs.js would serve each other's
// bootstrap and each UI would render the other's document.
//
// `serveFiles(doc, opts)` closes over its own bootstrap instead of
// reading the shared variable, which is the library's documented answer
// for serving more than one document from one app. Both surfaces use it,
// so neither depends on the module-level variable at all.

const { Router } = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const { openapiSpec } = require('../docs/openapi');
const rateLimitHandler = require('../middleware/rateLimitHandler');

const router = Router();

// Both routes are unauthenticated, so they get the same per-IP ceiling as
// the other public metadata endpoints rather than being left unmetered.
const docsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler('API docs rate limit exceeded. Retry in a minute.'),
});

router.get('/docs.json', docsLimiter, (_req, res) => {
  // Explicit charset: some codegen tools sniff the content type and
  // mis-decode multi-byte characters in the descriptions without it.
  res.type('application/json; charset=utf-8');
  res.json(openapiSpec);
});

// Swagger UI ships its bootstrap script and its CSS inline. The app-wide
// helmet policy sets `script-src 'self'` and `style-src 'self'`, which
// blocks both and renders a blank page. Rather than loosening the policy
// for the whole API, re-apply CSP for this subtree only: helmet writes
// the header with res.setHeader, so the route-scoped policy replaces the
// global one here and leaves every other response strict. No external
// host is permitted, so the page still works offline and cannot be
// turned into an exfiltration channel.
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

// `swaggerOptions.url` points the browser at /docs.json instead of
// embedding a snapshot of the document in the HTML: one source of truth,
// and the page picks up a spec change without anything else redeploying.
const swaggerUiOptions = {
  swaggerOptions: { url: '/docs.json', displayRequestDuration: true },
  customSiteTitle: 'Stellar_Card API',
};
const docsHtml = swaggerUi.generateHTML(null, swaggerUiOptions);

router.use(
  '/docs',
  docsLimiter,
  swaggerCsp,
  swaggerUi.serveFiles(null, swaggerUiOptions),
  (_req, res) => res.type('html').send(docsHtml),
);

module.exports = router;
