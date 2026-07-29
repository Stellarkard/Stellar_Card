// @ts-check
// GET /status — public health and throughput summary.
//
// Powers both the dashboard banner and the public status page at
// stellar_card.com/status (and status.stellar_card.com via the proxy
// rewrite). Mounted at the app root, unauthenticated, and cheap enough
// to hit every 10–30s: every query is indexed and bounded to a time
// window.

const { Router } = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../db');
const { openSSEStreamCount } = require('./orders');
const { MAX_WEBHOOK_ATTEMPTS: MAX_WEBHOOK_ATTEMPTS_FOR_STATUS } = require('../fulfillment');
const rateLimitHandler = require('../middleware/rateLimitHandler');

const router = Router();

// Cheap does not mean free: a per-IP limiter keeps an attacker from
// turning an unauthenticated endpoint that runs six COUNT/SUM queries
// per hit into a SQLite thrasher. 180/min per IP is ~3 req/s, generous
// for multi-tab dashboards behind NAT but tight enough to cap a hostile
// loop.
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  keyGenerator: (/** @type {any} */ req) => ipKeyGenerator(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler('Status endpoint rate limit exceeded. Retry in a minute.'),
});

const PROCESS_STARTED_AT = Date.now();

/** Read a system_state row by key, parse as int, default to 0. */
function sysStateInt(key) {
  const row = /** @type {any} */ (
    db.prepare(`SELECT value FROM system_state WHERE key = ?`).get(key)
  );
  return parseInt(row?.value || '0', 10) || 0;
}

router.get('/status', statusLimiter, (req, res) => {
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

module.exports = router;
