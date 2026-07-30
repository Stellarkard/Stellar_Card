// @ts-check
// Route registry — the single place that decides what is mounted where,
// and in what order.
//
// app.js used to interleave three unrelated concerns: application-level
// middleware (helmet, CORS, body parsing), route mounting, and ~400 lines
// of inline handler bodies for /status, /v1/agent/claim, /v1/agent/status,
// /v1/usage and /v1/policy/check. Those handlers were indistinguishable
// from the mounting logic, so the one thing a reader most needs from
// app.js — "which paths require an api key, and which do not" — was
// buried. Every handler now lives in its own module under api/, and this
// file is the answer to that question in about thirty lines.
//
// ── The ordering rules ────────────────────────────────────────────────
//
// Express matches middleware in registration order, so three of the
// mounts below are load-bearing and MUST NOT be reordered:
//
//   1. MPP routes mount at /v1 BEFORE the auth chain. Unauthenticated
//      payment discovery is the entire point of the Machine Payments
//      Protocol: /v1/.well-known/mpp, /v1/cards/:product/:amount, and
//      /v1/mpp/receipts/:id have to be reachable without an X-Api-Key
//      header. The router only matches those specific paths and calls
//      next() for anything else, so no other endpoint loses
//      authentication by being mounted behind it.
//
//   2. The claim endpoint mounts at /v1 BEFORE the auth chain, for the
//      same structural reason: POST /v1/agent/claim is how an agent
//      turns a dashboard-minted code INTO an api key, so requiring one
//      would be circular. It carries its own tight per-IP limiter.
//
//   3. authFailureLimiter MUST run before the auth middleware, not
//      after. It exists to cap a pre-auth DoS amplifier: every /v1/*
//      request runs through bcrypt before any per-route limiter would
//      normally fire, so a flood of malformed-but-prefix-valid keys
//      saturates a CPU core at ~15 req/s. The limiter checks its counter
//      at request START — always before downstream middleware — so
//      mounting it after auth would leave the bcrypt compare already
//      spent and the cap pointless. See middleware/auth.js and the
//      buildAuthFailureLimiter comment below.
//
// Everything after `app.use('/v1', auth)` is authenticated by
// construction. That is the invariant this file exists to make legible.

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const auth = require('../middleware/auth');
const versionRouter = require('../api/version');
const statusRouter = require('../api/status');
const docsRouter = require('../api/docs');
const swaggerRouter = require('../api/swagger');
const agentClaimRouter = require('../api/agent-claim');
const agentRouter = require('../api/agent');
const usageRouter = require('../api/usage');
const ordersRouter = require('../api/orders');
const authRouter = require('../api/auth');
// Legacy /admin/* router was retired with the ampersand dashboard
// rewrite. The /dashboard surface is the canonical operator API and is
// what /api/admin-proxy on the web app forwards to.
const dashboardRouter = require('../api/dashboard');
const internalRouter = require('../api/internal');
const platformRouter = require('../api/platform');
const vccCallbackRouter = require('../api/vcc-callback');

/**
 * Shared limiter for the operator surface (/dashboard, /internal). These
 * routes are already session-authenticated; the limit is a blast-radius
 * cap on a stolen session, not an authentication control.
 */
function buildAdminLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    keyGenerator: (/** @type {any} */ req) => ipKeyGenerator(req),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_, res) => res.status(429).json({ error: 'too_many_requests' }),
  });
}

/**
 * Adversarial audit F1-auth (2026-04-15): pre-auth DoS amplifier cap.
 *
 * `app.use('/v1', auth)` runs every /v1/* request through bcrypt before
 * any per-route rate limiter kicks in. A malformed-but-prefix-valid key
 * triggers one bcrypt compare (~60ms at cost 10) on a clean install, or
 * up to 20 compares on legacy installs via the NULL-prefix fallback —
 * see middleware/auth.js::MAX_AUTH_CANDIDATES. At 1 compare per request,
 * an attacker flooding bad keys saturates a single CPU core with ~15
 * requests per second. At 20 compares per request, 1 request per second
 * is enough.
 *
 * `skipSuccessfulRequests: true` is the kernel of the fix: every 2xx
 * response is NOT counted, so legitimate agents with valid keys are
 * unaffected regardless of poll cadence. Only the attacker's 401 /
 * missing_api_key / invalid_api_key responses consume budget.
 *
 * Default 60 failures per 15 minutes per IP. Generous for real agent
 * rotations or initial misconfiguration (a handful of failed attempts
 * before the operator realises they copy-pasted the wrong key), strict
 * enough to cap the amplifier at 60 × 60ms = 3.6s of CPU per IP per 15
 * minutes ≈ 0.4% CPU per attacker IP. A multi-IP distributed attack
 * still works but costs the attacker real infrastructure for a
 * fraction-of-a-percent CPU hit per IP. Env-configurable via
 * AUTH_FAILURE_LIMIT_PER_WINDOW so ops can tighten further after
 * observing real traffic.
 */
function buildAuthFailureLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: parseInt(process.env.AUTH_FAILURE_LIMIT_PER_WINDOW || '60', 10),
    skipSuccessfulRequests: true,
    keyGenerator: (/** @type {any} */ req) => ipKeyGenerator(req),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({
        error: 'too_many_failed_auth_attempts',
        message:
          'Too many failed authentication attempts from this IP. Wait a few minutes and retry with a valid key.',
      }),
  });
}

/**
 * VCC fulfillment callbacks are HMAC-authenticated and carry no session.
 *
 * Bucketed by client IP (the default keyGenerator) rather than a single
 * global key. An earlier version used `() => 'vcc-callback'`, which
 * collapsed every caller into one shared counter — an attacker flooding
 * the endpoint would exhaust the limit and lock out legitimate VCC
 * callbacks. `trust proxy` is set in app.js, so req.ip resolves to the
 * real client IP and a single-IP flood gets rate-limited on its own
 * counter instead of starving everyone else.
 *
 * 120/min per IP = 2/sec, comfortably above the steady-state rate of
 * legitimate callbacks (one per order, rarely bursting past a handful
 * per minute) and tight enough that one attacker cannot saturate the
 * endpoint's CPU.
 */
function buildVccCallbackLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_, res) => res.status(429).json({ error: 'too_many_requests' }),
  });
}

/**
 * Mount every route onto the application.
 *
 * Called by app.js after the application-level middleware chain and
 * before the error handlers. Ordering within this function is
 * significant — see the module header.
 *
 * @param {import('express').Express} app
 */
function registerRoutes(app) {
  const adminLimiter = buildAdminLimiter();

  // ── Unauthenticated surface ────────────────────────────────────────
  app.use(versionRouter);
  app.use(statusRouter);
  // The published contract, and Swagger UI over it. Unauthenticated by
  // design: an integrator has to be able to read the API before they
  // have a key to call it with. Only the public and agent-facing routes
  // are described — see the scope note in api/openapi.js.
  app.use(docsRouter);
  // The second documentation surface: /docs.json and the Swagger UI over
  // it, generated by swagger-jsdoc from the `@openapi` blocks that sit
  // beside the handlers. Both surfaces have callers and tests; the header
  // of api/swagger.js explains why they coexist and how they avoid
  // fighting over swagger-ui-express's module-level state.
  app.use(swaggerRouter);

  // Rule 2: claim redemption predates the api key it hands out.
  app.use('/v1', agentClaimRouter);

  // MPP (Machine Payments Protocol) is feature-flagged so the code can
  // ship dark in production before rollout — see rule 1 in the module
  // header.
  if ((process.env.MPP_ENABLED || 'false') === 'true') {
    const { buildMppRouter } = require('../mpp/router');
    app.use('/v1', buildMppRouter());
  }

  // ── The /v1 auth boundary ──────────────────────────────────────────
  // Rule 3: the failure limiter runs BEFORE auth, or the bcrypt compare
  // it is capping has already happened.
  app.use('/v1', buildAuthFailureLimiter());
  app.use('/v1', auth);

  // ── Authenticated agent surface ────────────────────────────────────
  app.use('/v1/orders', ordersRouter);
  app.use('/v1', usageRouter);
  app.use('/v1', agentRouter);

  // ── Operator surface ───────────────────────────────────────────────
  app.use('/auth', authRouter);
  // Platform-owner cross-tenant routes mount BEFORE /dashboard so their
  // prefix catches /dashboard/platform/* before the tenant-scoped
  // dashboard router sees it. requirePlatformOwner inside the router is
  // what actually restricts access; the ordering only decides which
  // router gets the request.
  app.use('/dashboard/platform', adminLimiter, platformRouter);
  app.use('/dashboard', adminLimiter, dashboardRouter);
  app.use('/internal', adminLimiter, internalRouter);

  // ── Machine-to-machine callbacks ───────────────────────────────────
  app.use('/vcc-callback', buildVccCallbackLimiter(), vccCallbackRouter);

  return app;
}

module.exports = {
  registerRoutes,
  buildAuthFailureLimiter,
  buildAdminLimiter,
  buildVccCallbackLimiter,
};
