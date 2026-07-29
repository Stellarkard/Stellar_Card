// @ts-check
// GET /openapi.json, GET /docs — Swagger/OpenAPI documentation for the
// public/agent-facing API surface (see src/docs/openapi.js for the spec).
//
// Unauthenticated by design, same as /api/version and /status: an
// integrator needs to read the contract before it has an API key. Rate
// limited for consistency with every other unauthenticated route in
// this codebase, even though serving a static document is cheap.

const { Router } = require('express');
const swaggerUi = require('swagger-ui-express');
const { rateLimit } = require('express-rate-limit');
const rateLimitHandler = require('../middleware/rateLimitHandler');
const { openapiSpec } = require('../docs/openapi');

const router = Router();

const docsLimiter = rateLimit({
  windowMs: 60000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler('Docs endpoint rate limit exceeded. Retry in a minute.'),
});

router.get('/openapi.json', docsLimiter, (_req, res) => {
  res.json(openapiSpec);
});

router.use('/docs', docsLimiter, swaggerUi.serve, swaggerUi.setup(openapiSpec));

module.exports = router;
