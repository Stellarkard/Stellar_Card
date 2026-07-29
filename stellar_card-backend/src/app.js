// @ts-check
// Express application — importable without starting the Stellar watcher or jobs.
// index.js is the entry point that wires everything up for production.

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { log } = require('./lib/logger');
const {
  sentryRequestHandler,
  sentryErrorHandler,
  setRequestId: setSentryRequestId,
} = require('./lib/sentry-config');
const errorHandler = require('./middleware/errorHandler');
const { registerRoutes } = require('./routes');

const app = express();

// Sentry's request handler must be the very first middleware: it opens
// the per-request scope that every later captureException() attaches
// itself to, and anything mounted above it reports without request
// context. It is a pass-through no-op when SENTRY_DSN is unset, which is
// the case in development and across the whole test suite.
// Issue #29: src/lib/sentry-config.js was fully built (init, request/error
// handler middleware, capture helpers) but never actually wired into the
// app — initSentry() had no caller anywhere in src/, so error tracking was
// silently a no-op in every environment, production included. The request
// handler must be the very first middleware (per Sentry's own docs) so it
// can attach its transaction/scope before anything else runs; the error
// handler must run before (not instead of) the app's own errorHandler so
// Sentry sees every error the same way that handler does. Both are no-ops
// outside production (see sentryRequestHandler/sentryErrorHandler in
// sentry-config.js), so this has no effect on dev/test behavior.
app.use(sentryRequestHandler());

// B-13: Attach a unique request ID to every request for log correlation.
//
// F1-app (2026-04-16): validate client-supplied X-Request-ID shape
// before accepting it. Pre-fix, `String(req.headers['x-request-id'])`
// accepted anything the client sent. Three real problems:
//
//   1. Header injection self-DoS: a client sending
//      `X-Request-ID: foo\r\nBcc: attacker` would hit the
//      `res.setHeader('X-Request-ID', req.id)` call below and trigger
//      Node's ERR_INVALID_CHAR → the middleware throws before any
//      route handler runs. Every request from that client 500s.
//
//   2. Outbound header corruption: req.id is persisted to
//      `orders.request_id` and later passed to vcc-client.getInvoice,
//      which sets it as the `X-Request-ID` header on outbound fetches
//      to vcc.ctx.com. A garbage-shaped id breaks those fetches with
//      cryptic errors that have nothing to do with the real failure.
//
//   3. Forensics trust: log entries with attacker-controlled correlation
//      ids look indistinguishable from server-generated ones. Ops grepping
//      for a real incident can't tell which rows are trustworthy.
//
// Fix: accept a narrow charset (alphanumeric + dash + underscore + dot
// + colon) up to 64 chars. This is permissive enough for UUIDs, RFC 3986
// token characters, OpenTelemetry trace IDs (32 hex), Sentry event IDs,
// and common SDK formats — but rejects every header-breaking character
// (CR, LF, NUL, space, etc.) and bounds the length.
//
// Invalid or missing client header → fall back to a server-generated
// UUID and emit a bizEvent (one per offending IP, dedup'd) so ops
// sees systematic misuse without log spam.
const REQ_ID_SHAPE = /^[A-Za-z0-9._:-]{1,64}$/;
const _reqIdWarnedIps = new Set();

function validateRequestId(raw) {
  // Node joins duplicate headers with ', ' by default for most header
  // names, but defensively handle both string[] and string.
  if (Array.isArray(raw)) raw = raw[0];
  if (typeof raw !== 'string') return null;
  if (!REQ_ID_SHAPE.test(raw)) return null;
  return raw;
}

app.use((req, res, next) => {
  const rawHeader = req.headers['x-request-id'];
  const validated = validateRequestId(rawHeader);
  if (rawHeader !== undefined && validated === null) {
    // Client supplied something but it didn't match the shape. Dedup
    // the warn per remote address so a repeat offender doesn't spam
    // the log. Scoped to req.ip which Express resolves via trust proxy.
    const ip = req.ip || 'unknown';
    if (!_reqIdWarnedIps.has(ip)) {
      _reqIdWarnedIps.add(ip);
      // Lazy-require so the logger cycle is safe; log-module caches
      // its own state.
      try {
        const { event: bizEvent } = require('./lib/logger');
        bizEvent('request.invalid_request_id', {
          ip,
          raw_preview: String(rawHeader).slice(0, 48),
        });
      } catch {
        /* observability must not block the request */
      }
    }
  }
  req.id = validated || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  // Tag the Sentry scope with the same correlation id the structured
  // logs carry, so an event in Sentry can be joined back to the log
  // lines for the request that produced it. No-op when Sentry is off.
  setSentryRequestId(req.id);
  log('info', 'request', { req_id: req.id, method: req.method, path: req.path });
  next();
});

// Test-only: reset the invalid-request-id dedup cache so unit tests
// can observe the first-offender warn path independently. Not part of
// the public contract.
function _resetReqIdWarnState() {
  _reqIdWarnedIps.clear();
}

/** @type {any} */ const helmetMiddleware = helmet;
// helmet defaults are fine for everything except the HSTS header — the
// built-in default is max-age=15552000 (180 days) with no `preload`
// directive, which is too short to qualify for the Chrome HSTS preload
// list. Bump to two years + preload so api.stellar_card.com can be
// submitted to hstspreload.org and every browser refuses plaintext
// even on first visit. frameguard stays at SAMEORIGIN (API JSON
// responses don't need to be embeddable anywhere).
app.use(
  helmetMiddleware({
    hsts: {
      maxAge: 63072000, // 2 years
      includeSubDomains: true,
      preload: true,
    },
  }),
);
app.set('trust proxy', 1);

// Audit A-25: require HTTPS in non-development environments. A misconfigured
// production deploy that terminates plaintext (e.g. behind a load balancer
// forwarding HTTP) would otherwise ship API keys over the wire unencrypted.
// Honors `X-Forwarded-Proto` because `trust proxy` is set above, so a TLS
// terminator in front (Cloudflare, nginx, ALB) works correctly.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto !== 'https') {
      return res.status(426).json({
        error: 'https_required',
        message: 'This endpoint requires HTTPS. Retry over https://',
      });
    }
    next();
  });
}

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// F4-cors: validate each allowlisted origin at boot. A typo like
// "https//stellar_card.com" (missing colon) otherwise silently fails
// closed — the string never matches a real browser origin and ops
// spends time debugging from the browser console instead of seeing
// a loud startup error. Node's URL throws on bad input; we re-check
// that the normalised .origin equals the configured value so
// ambiguous forms (trailing slash, path, query) get rejected too.
// The origin header per RFC 6454 never includes a trailing slash or
// path, so "https://stellar_card.com/" would never match anyway —
// rejecting at boot instead of at request time makes the mistake
// obvious.
for (const entry of allowedOrigins) {
  try {
    const parsed = new URL(entry);
    if (parsed.origin !== entry) {
      console.error(
        `[cors] CORS_ORIGINS entry ${JSON.stringify(entry)} is not a bare origin ` +
          `(browsers never send trailing slashes or paths in Origin headers). ` +
          `Expected: ${JSON.stringify(parsed.origin)}`,
      );
      process.exit(1);
    }
  } catch {
    console.error(
      `[cors] CORS_ORIGINS entry ${JSON.stringify(entry)} is not a valid URL. ` +
        `Generate one like "https://stellar_card.com" (no path, no trailing slash).`,
    );
    process.exit(1);
  }
}

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('CORS: origin not allowed'));
    },
    // F1-cors: DELETE was missing. Not currently broken because the
    // dashboard proxies through /api/admin-proxy (server-side =
    // CORS-exempt), but any future direct-to-backend client would
    // have every DELETE operation blocked by preflight.
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    // F2-cors: X-Request-ID is read by app.js for log correlation.
    // A cross-origin client that sets it for traceability previously
    // had its preflight rejected because it wasn't in the allowlist.
    allowedHeaders: [
      'Content-Type',
      'X-Api-Key',
      'Authorization',
      'Idempotency-Key',
      'X-Request-ID',
    ],
    // F3-cors: expose X-Request-ID so cross-origin clients can read
    // it from responses. Browsers only expose the CORS safelist
    // (Cache-Control, Content-Language, Content-Type, Expires,
    // Last-Modified, Pragma) by default — without this, an SDK
    // couldn't read the server-assigned request id it needs to
    // correlate a failed call with server logs.
    exposedHeaders: ['X-Request-ID'],
    maxAge: 3600,
  }),
);

// Capture raw body for HMAC signature verification (used by /vcc-callback)
app.use(
  express.json({
    limit: '64kb',
    verify: (/** @type {any} */ req, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
);

// ── Routes ────────────────────────────────────────────────────────────────────
// All route mounts live in src/routes/index.js — see registerRoutes(app) below.
//
// Still wants a per-IP limiter so an attacker can't turn the public
// /status endpoint into a cheap SQLite thrasher — the handler runs
// six COUNT/SUM queries on every hit and is unauthenticated. 180/min
// per IP is ~3 req/s, generous for multi-tab dashboards behind NAT
// but tight enough to cap a hostile loop.
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  keyGenerator: (/** @type {any} */ req) => ipKeyGenerator(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_, res) => res.status(429).json({ error: 'too_many_requests' }),
});

const PROCESS_STARTED_AT = Date.now();

/** Read a system_state row by key, parse as int, default to 0. */
function sysStateInt(key) {
  const row = /** @type {any} */ (
    db.prepare(`SELECT value FROM system_state WHERE key = ?`).get(key)
  );
  return parseInt(row?.value || '0', 10) || 0;
}

app.get('/status', statusLimiter, (req, res) => {
  const frozen =
    /** @type {any} */ (db.prepare(`SELECT value FROM system_state WHERE key = 'frozen'`).get())
      ?.value === '1';
  const consecutiveFailures = sysStateInt('consecutive_failures');

  const pendingCount =
    /** @type {any} */ (
      db.prepare(`SELECT COUNT(*) as n FROM orders WHERE status = 'pending_payment'`).get()
    )?.n ?? 0;
  const inProgressCount =
    /** @type {any} */ (
      db
        .prepare(
          `SELECT COUNT(*) as n FROM orders WHERE status IN ('ordering','payment_confirmed','claim_received','stage1_done')`,
        )
        .get()
    )?.n ?? 0;
  const refundPendingCount =
    /** @type {any} */ (
      db.prepare(`SELECT COUNT(*) as n FROM orders WHERE status = 'refund_pending'`).get()
    )?.n ?? 0;

  // Rolling 24h counts by terminal state. Indexed on created_at so this
  // is a range scan of the last day's rows — typically a few hundred.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const last24hRow = /** @type {any} */ (
    db
      .prepare(
        `
      SELECT
        SUM(CASE WHEN status = 'delivered'      THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status = 'failed'         THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'refunded'       THEN 1 ELSE 0 END) AS refunded,
        SUM(CASE WHEN status = 'refund_pending' THEN 1 ELSE 0 END) AS refund_pending,
        SUM(CASE WHEN status = 'expired'        THEN 1 ELSE 0 END) AS expired,
        COUNT(*) AS total
      FROM orders
      WHERE created_at >= ?
    `,
      )
      .get(since24h)
  );
  const delivered24h = last24hRow?.delivered ?? 0;
  const failed24h = last24hRow?.failed ?? 0;
  const refunded24h = last24hRow?.refunded ?? 0;
  const expired24h = last24hRow?.expired ?? 0;
  const total24h = last24hRow?.total ?? 0;
  // Success rate: delivered over (delivered + failed + refunded). Excludes
  // expired orders (agent abandoned) and pending rows (not yet terminal).
  const terminal24h = delivered24h + failed24h + refunded24h;
  const successRate24h = terminal24h > 0 ? delivered24h / terminal24h : null;

  // Stellar watcher freshness. `stellar_start_ledger` advances as the
  // watcher persists its cursor; `stellar_start_ledger_at` captures the
  // wall clock of that update. Both rows are upserted together in
  // saveStartLedger.
  //
  // Staleness threshold: the watcher polls every POLL_MS=1500ms and
  // backs off to 4× on errors (~6s max between cursor advances under
  // error conditions). 120s is 20× the error-backoff window — any
  // gap longer than that almost certainly means the watcher has
  // silently died. Adversarial audit F1-status: before this the `ok`
  // flag did not incorporate watcher staleness, so a crashed watcher
  // would keep reporting ok:true to every ops alerting system that
  // scraped /status.
  const STELLAR_WATCHER_MAX_AGE_SECONDS = 120;
  const lastLedger = sysStateInt('stellar_start_ledger');
  const lastLedgerAtRow = /** @type {any} */ (
    db.prepare(`SELECT value FROM system_state WHERE key = 'stellar_start_ledger_at'`).get()
  );
  const lastLedgerAt = lastLedgerAtRow?.value || null;
  const lastLedgerAgeSeconds = lastLedgerAt
    ? Math.round((Date.now() - new Date(lastLedgerAt).getTime()) / 1000)
    : null;
  // Treat null age as "unknown" rather than "stalled" so fresh
  // installs and tests (where the watcher isn't started) don't
  // flip ok to false. Production deployments that have been
  // running for any length of time will have a non-null value —
  // if the watcher dies after its first cursor save, the age
  // grows past the threshold and ok flips as intended.
  const stellarWatcherStalled =
    lastLedgerAgeSeconds !== null && lastLedgerAgeSeconds > STELLAR_WATCHER_MAX_AGE_SECONDS;

  // Silent-failure visibility counters (audit topic: observability).
  //
  // stellar_dead_letter: on-chain events the watcher couldn't parse.
  // Non-zero means the watcher saw an event that won't match any
  // pending order — someone (ops) needs to investigate the raw_event
  // rows and either reconcile manually or refund.
  //
  // webhooks_failed_permanently: rows left in webhook_queue with
  // attempts >= MAX_WEBHOOK_ATTEMPTS and delivered = 0. Before the
  // /status surface, these accumulated silently and only surfaced
  // when ops happened to query the table by hand (which is how the
  // outbound-TLS bug was found). Now it's a first-class health signal.
  const stellarDeadLetter24h =
    /** @type {any} */ (
      db
        .prepare(`SELECT COUNT(*) AS n FROM stellar_dead_letter WHERE created_at >= ?`)
        .get(since24h)
    )?.n ?? 0;
  const webhooksFailedPermanent24h =
    /** @type {any} */ (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM webhook_queue
           WHERE delivered = 0 AND attempts > ? AND created_at >= ?`,
        )
        .get(MAX_WEBHOOK_ATTEMPTS_FOR_STATUS, since24h)
    )?.n ?? 0;

  res.json({
    ok:
      !frozen &&
      consecutiveFailures < 3 &&
      stellarDeadLetter24h === 0 &&
      webhooksFailedPermanent24h < 5 &&
      !stellarWatcherStalled,
    frozen,
    consecutive_failures: consecutiveFailures,
    orders: {
      pending_payment: pendingCount,
      in_progress: inProgressCount,
      refund_pending: refundPendingCount,
    },
    last_24h: {
      total: total24h,
      delivered: delivered24h,
      failed: failed24h,
      refunded: refunded24h,
      expired: expired24h,
      success_rate: successRate24h, // 0..1 or null if no terminal orders
    },
    stellar_watcher: {
      last_ledger: lastLedger || null,
      last_ledger_at: lastLedgerAt,
      age_seconds: lastLedgerAgeSeconds,
      stalled: stellarWatcherStalled,
      max_age_seconds: STELLAR_WATCHER_MAX_AGE_SECONDS,
      dead_letter_24h: stellarDeadLetter24h,
    },
    webhooks: {
      failed_permanent_24h: webhooksFailedPermanent24h,
    },
    sse: openSSEStreamCount(),
    process: {
      uptime_seconds: Math.round((Date.now() - PROCESS_STARTED_AT) / 1000),
      started_at: new Date(PROCESS_STARTED_AT).toISOString(),
    },
    generated_at: new Date().toISOString(),
  });
});

// Adversarial audit F1-auth (2026-04-15): pre-auth DoS amplifier cap.
//
// `app.use('/v1', auth)` runs every /v1/* request through bcrypt before
// any per-route rate limiter kicks in. A malformed-but-prefix-valid key
// triggers one bcrypt compare (~60ms at cost 10) on a clean install, or
// up to 20 compares on legacy installs via the NULL-prefix fallback —
// see middleware/auth.js::MAX_AUTH_CANDIDATES. At 1 compare per request,
// an attacker flooding bad keys saturates a single CPU core with ~15
// requests per second. At 20 compares per request, 1 request per second
// is enough.
//
// Fix: failed-auth-only rate limiter, keyed per-IP, applied BEFORE the
// auth middleware. `skipSuccessfulRequests: true` means every 2xx
// response is NOT counted, so legitimate agents with valid keys are
// unaffected regardless of poll cadence. Only the attackers' 401 /
// missing_api_key / invalid_api_key responses consume budget.
//
// Default 60 failures per 15 minutes per IP. Generous for real agent
// rotations or initial misconfiguration (a handful of failed attempts
// before the operator realises they copy-pasted the wrong key),
// strict enough to cap the amplifier at 60 × 60ms = 3.6s of CPU per
// IP per 15 minutes ≈ 0.4% CPU per attacker IP. A multi-IP distributed
// attack still works but costs the attacker real infrastructure for a
// fraction-of-a-percent CPU hit per IP. Env-configurable via
// AUTH_FAILURE_LIMIT_PER_WINDOW so ops can tighten further after
// observing real traffic.
const authFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parseInt(process.env.AUTH_FAILURE_LIMIT_PER_WINDOW || '60', 10),
  // The kernel of the fix: only count responses that didn't succeed.
  // Legit agents polling /v1/orders/:id at 10/s never touch this budget.
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

// Mount MPP routes BEFORE the auth chain — the whole point of MPP is
// unauthenticated payment discovery, so /v1/.well-known/mpp,
// /v1/cards/:product/:amount, and /v1/mpp/receipts/:id must be reachable
// without an X-Api-Key header. The router's handlers only match those
// specific paths; any other /v1 request falls through via next() into
// authFailureLimiter + auth below, so no other endpoint accidentally
// loses authentication.
//
// Gated by MPP_ENABLED so the code can ship dark in prod before rollout.
if ((process.env.MPP_ENABLED || 'false') === 'true') {
  const { buildMppRouter } = require('./mpp/router');
  app.use('/v1', buildMppRouter());
}

// Order is critical: authFailureLimiter MUST run before auth. If it
// runs after, the bcrypt compare has already executed and the cap is
// pointless. The limiter internally checks the counter at request
// START — which is always before any downstream middleware — and
// increments it once the response is flushed.
app.use('/v1', authFailureLimiter);

// All /v1/* routes require a valid API key
app.use('/v1', auth);

app.use('/v1/orders', ordersRouter);

// GET /v1/policy/check?amount=X — dry-run policy check without creating an order
// Runs a SUM over orders per request, so it needs the same per-key
// throttle as /v1/orders polling. Before this limiter was added, a
// compromised key could enumerate the owner's daily spend and bruteforce
// policy thresholds without burning order-creation budget.
app.get('/v1/policy/check', orderPollLimiter, (req, res) => {
  const amount = String(req.query.amount || '');
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res
      .status(400)
      .json({ error: 'invalid_amount', message: 'Query param ?amount= must be a positive number' });
  }
  return res.json(policyCheck(req.apiKey.id, parseFloat(amount)));
});

// POST /v1/agent/status — agent reports setup / lifecycle transitions.
// Drives the live "onboarding state" pill in the dashboards. Idempotent:
// an agent can POST the same state repeatedly without side-effects.
//
// Every POST emits a bizEvent and fans out an agent_state event on the
// in-process bus, which the dashboard SSE stream picks up and relays to
// every connected browser. Without a limiter, an agent stuck in a tight
// loop (or a compromised key) could flood the bus and 100% the SSE fan-out.
// 60/min per key is ~20× the real workload — an agent only transitions
// through ~4 states over onboarding and rarely reports afterwards.
const agentStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (/** @type {any} */ req) =>
    /** @type {any} */ (req).apiKey?.id || ipKeyGenerator(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_, res) => res.status(429).json({ error: 'too_many_requests' }),
});
app.post('/v1/agent/status', agentStatusLimiter, (req, res) => {
  const { emit: emitBusEvent } = require('./lib/event-bus');
  const { StrKey } = require('@stellar/stellar-sdk');
  const ALLOWED_STATES = new Set(['initializing', 'awaiting_funding', 'funded']);
  const { state, wallet_public_key, detail } = req.body || {};

  if (state !== undefined && !ALLOWED_STATES.has(state)) {
    return res.status(400).json({
      error: 'invalid_state',
      message: `state must be one of: ${[...ALLOWED_STATES].join(', ')} (the 'minted' and 'active' states are derived automatically from activity)`,
    });
  }
  // F2-agent-status: StrKey.isValidEd25519PublicKey enforces the
  // Stellar Ed25519 checksum — the previous regex only checked the
  // shape (56 chars, base32 charset) and would accept a typo'd address
  // with a wrong checksum. That stored silently and later blew up in
  // the xlm-sender path (which now uses StrKey itself) or Horizon's
  // account loader. Fail at the write boundary so the bad value never
  // enters the DB.
  if (wallet_public_key !== undefined && wallet_public_key !== null) {
    if (
      typeof wallet_public_key !== 'string' ||
      !StrKey.isValidEd25519PublicKey(wallet_public_key)
    ) {
      return res.status(400).json({
        error: 'invalid_wallet_public_key',
        message: 'wallet_public_key must be a valid Stellar G-address (base32 + checksum)',
      });
    }
  }

  const fields = [];
  const params = { id: req.apiKey.id, at: new Date().toISOString() };
  // F1-agent-status: build the fanout event payload alongside the
  // UPDATE so the broadcast mirrors the actually-updated set. The
  // previous version null-padded every field the caller didn't
  // provide, so a detail-only POST emitted {state: null, ...} over
  // the bus and dashboard SSE subscribers that treated null as
  // "cleared" visually regressed the onboarding pill.
  /** @type {Record<string, any>} */
  const eventPayload = { api_key_id: req.apiKey.id };
  if (state !== undefined) {
    fields.push('agent_state = @state', 'agent_state_at = @at');
    params.state = state;
    eventPayload.state = state;
  }
  if (wallet_public_key !== undefined) {
    fields.push('wallet_public_key = @wallet_public_key');
    params.wallet_public_key = wallet_public_key || null;
    eventPayload.wallet_public_key = wallet_public_key || null;
  }
  if (detail !== undefined) {
    // Reject non-string detail — without the typeof guard an object
    // coerces to "[object Object]" via String(), which passes the length
    // check but stores a nonsense row in agent_state_detail.
    if (detail !== null && typeof detail !== 'string') {
      return res.status(400).json({
        error: 'invalid_detail',
        message: 'detail must be a string or null',
      });
    }
    fields.push('agent_state_detail = @detail');
    params.detail = detail ? detail.slice(0, 500) : null;
    eventPayload.detail = params.detail;
  }
  if (fields.length === 0) {
    return res.status(400).json({
      error: 'nothing_to_update',
      message: 'Provide at least one of: state, wallet_public_key, detail',
    });
  }

  db.prepare(`UPDATE api_keys SET ${fields.join(', ')} WHERE id = @id`).run(params);

  emitBusEvent('agent_state', eventPayload);

  res.json({ ok: true });
});

// GET /v1/usage — agent's own spend and order summary
// Runs COUNT + SUM over orders. Same per-key throttle as the rest of
// the agent read surface.
//
// Adversarial audit (2026-04-15):
//
// F2-usage: in_progress previously used `NOT IN ('delivered','failed',
//   'refunded')` as the complement filter — which incorrectly counted
//   EXPIRED and REJECTED orders (both terminal-negative) as still in
//   progress. An agent with 5 dead expired orders saw "5 orders in
//   progress" when nothing was actually in flight. Now excludes every
//   terminal status from the complement and uses COALESCE so an empty
//   orders table returns 0 instead of null per-bucket.
//
// F3-usage: added explicit expired and rejected counters so agents
//   can see the full picture — previously both were hidden inside the
//   wrong in_progress bucket.
app.get('/v1/usage', orderPollLimiter, (req, res) => {
  const counts = db
    .prepare(
      `
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
      COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0) AS refunded,
      COALESCE(SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END), 0) AS expired,
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
      COALESCE(SUM(CASE WHEN status NOT IN ('delivered','failed','refunded','expired','rejected') THEN 1 ELSE 0 END), 0) AS in_progress
    FROM orders WHERE api_key_id = ?
  `,
    )
    .get(req.apiKey.id);
  res.json({
    api_key_id: req.apiKey.id,
    label: req.apiKey.label,
    budget: buildBudget(req.apiKey),
    orders: counts,
  });
});

app.use('/auth', authRouter);
// Platform-owner cross-tenant surface. Mounted BEFORE /dashboard so its
// prefix catches /dashboard/platform/* before the tenant-scoped
// dashboard router sees it. Gated by requirePlatformOwner inside the
// router so only the deployment's platform owner can hit these routes.
app.use('/dashboard/platform', adminLimiter, platformRouter);
app.use('/dashboard', adminLimiter, dashboardRouter);
app.use('/internal', adminLimiter, internalRouter);
// VCC callback — HMAC-authenticated, no session required.
//
// Bucket by client IP (the default keyGenerator) rather than a single
// global key. The earlier version used `() => 'vcc-callback'` which
// collapsed every caller into one shared counter — an attacker flooding
// the endpoint would exhaust the limit and lock out legitimate VCC
// fulfillment callbacks from the real service. `trust proxy` is set to
// 1 above, so req.ip resolves to the real client IP via X-Forwarded-For
// and legitimate traffic from the VCC service (one origin) stays well
// under the ceiling while single-IP floods get rate-limited on their
// own counter instead of starving everyone else.
//
// 120/min per IP = 2/sec, comfortably above the steady-state rate of
// legitimate callbacks (one per order, bursting rarely past a handful
// per minute) and tight enough that a single attacker can't saturate
// the endpoint's CPU.
const vccCallbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_, res) => res.status(429).json({ error: 'too_many_requests' }),
});
app.use('/vcc-callback', vccCallbackLimiter, vccCallbackRouter);

// Structured CORS denial — cors() throws on rejected origins; catch and return clean 403.
// Non-CORS errors are forwarded to the next error handler (sentryErrorHandler then errorHandler)
// so they are reported and responded to by the proper chain.
app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: 'forbidden', message: 'Origin not allowed' });
  }
  next(err);
});
// Every route lives in its own module under api/, and routes/index.js owns
// the mount table. Three of those mounts are order-sensitive (the
// unauthenticated MPP and claim endpoints, and the pre-auth failure limiter)
// and the reasoning is documented there rather than here, so the answer to
// "which paths require an api key" lives in exactly one place.
registerRoutes(app);

app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: 'The requested endpoint does not exist.',
    req_id: req.id,
  });
});

// Issue #29: Sentry's error handler must be mounted after all routes but
// before the app's own errorHandler, so it can capture the error and then
// call next(err) to hand off to errorHandler for the actual response —
// see the app.use(sentryRequestHandler()) comment above for why this was
// previously dead code.
app.use(sentryErrorHandler());

// Standardized global error handler
app.use(errorHandler);

module.exports = app;
// Test-only exports for the 2026-04-16 audit hardening. Not part of
// the production surface — consumers should `require('./app')` and
// get the Express app.
module.exports._validateRequestId = validateRequestId;
module.exports._resetReqIdWarnState = _resetReqIdWarnState;
module.exports._REQ_ID_SHAPE = REQ_ID_SHAPE;
