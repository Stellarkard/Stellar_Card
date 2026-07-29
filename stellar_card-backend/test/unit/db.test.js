// Unit tests for db.js schema initialization and core query behaviour.
// Exercises table existence, seed data, migration bookkeeping, index
// coverage, constraint enforcement, transaction semantics, and the
// aggregate query shapes the HTTP surface depends on.
//
// Two flavours of test live here:
//
//   1. In-memory tests, which run against the shared `:memory:` instance
//      the test helper boots. Cheap, and the right fit for anything that
//      only needs the schema.
//   2. Fresh-instance tests (see `bootFreshDb`), which spawn a child
//      process that requires src/db.js against a real on-disk file. These
//      exist because a handful of db.js behaviours are structurally
//      unobservable in-memory: SQLite silently ignores `journal_mode=WAL`
//      on `:memory:` databases (it reports `memory`), and migration
//      idempotency can only be checked by opening the same file twice.

require('../helpers/env');

const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { v4: uuidv4 } = require('uuid');
const { db, resetDb } = require('../helpers/app');

// Must stay in lock-step with EXPECTED_SCHEMA_VERSION in src/db.js. The
// test asserting equality is the tripwire for a migration added without
// bumping the constant — that mismatch is what the "refusing to start"
// guard at the bottom of db.js keys off, so a silent drift here turns
// into a production boot failure.
const EXPECTED_SCHEMA_VERSION = 29;

const DB_MODULE_PATH = path.join(__dirname, '..', '..', 'src', 'db.js');

// ── Helpers ────────────────────────────────────────────────────────────────

function insertApiKey({ id = uuidv4(), keyHash = `hash-${uuidv4()}`, label = 'test' } = {}) {
  db.prepare(`INSERT INTO api_keys (id, key_hash, label) VALUES (?, ?, ?)`).run(id, keyHash, label);
  return id;
}

function insertOrder({ id = uuidv4(), apiKeyId = null, status = 'pending_payment' } = {}) {
  db.prepare(
    `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id)
     VALUES (?, ?, '5.00', 'usdc', ?)`,
  ).run(id, status, apiKeyId);
  return id;
}

/**
 * Boot src/db.js in a child process against a real on-disk database and
 * return whatever the supplied expression evaluates to.
 *
 * A child process (rather than a second in-process `new Database(...)`)
 * is deliberate: db.js is a singleton that runs its schema + migration
 * side effects at require time and is already cached by the parent
 * process. Re-requiring it there would hand back the `:memory:` handle
 * and test nothing. The child gets a clean module registry and a
 * DB_PATH of our choosing, so it exercises the exact code path a real
 * boot takes.
 *
 * @param {string} dbPath absolute path to the SQLite file to open
 * @param {string} expression JS expression evaluated with `db` in scope;
 *   its value is JSON-serialised back to the caller
 * @returns {any} the parsed result of `expression`
 */
function bootFreshDb(dbPath, expression) {
  const script = `
    const db = require(${JSON.stringify(DB_MODULE_PATH)});
    process.stdout.write(JSON.stringify(${expression}));
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

// ── Schema: required tables exist ─────────────────────────────────────────

describe('db.js — schema initialization', () => {
  it('creates the orders table', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='orders'`)
      .get();
    assert.ok(row, 'orders table should exist');
  });

  it('creates the api_keys table', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='api_keys'`)
      .get();
    assert.ok(row, 'api_keys table should exist');
  });

  it('creates the idempotency_keys table', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_keys'`)
      .get();
    assert.ok(row, 'idempotency_keys table should exist');
  });

  it('creates the webhook_queue table', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='webhook_queue'`)
      .get();
    assert.ok(row, 'webhook_queue table should exist');
  });

  it('creates the system_state table', () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='system_state'`)
      .get();
    assert.ok(row, 'system_state table should exist');
  });

  // Every table the migration chain is responsible for. Asserted as one
  // set rather than table-by-table so a migration that silently stops
  // running (e.g. a version-number collision that makes applyMigration
  // short-circuit) fails loudly here instead of surfacing as a
  // "no such table" 500 in whichever route touches it first.
  it('creates every table the migration chain declares', () => {
    const names = new Set(
      /** @type {any[]} */ (
        db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all()
      ).map((r) => r.name),
    );
    for (const table of [
      'admin_actions',
      'agent_claims',
      'alert_firings',
      'alert_rules',
      'approval_requests',
      'audit_log',
      'auth_codes',
      'dashboards',
      'mpp_challenges',
      'policy_decisions',
      'schema_migrations',
      'sessions',
      'stellar_dead_letter',
      'unmatched_payments',
      'users',
      'webhook_deliveries',
    ]) {
      assert.ok(names.has(table), `${table} table should exist`);
    }
  });

  // Columns added by ALTER TABLE in later migrations. A failed ALTER is
  // swallowed by db.js's `catch (_) { /* column already exists */ }`, so
  // a genuinely broken migration is invisible without an explicit check.
  it('applies the ALTER TABLE columns added after the baseline schema', () => {
    const orderCols = new Set(
      /** @type {any[]} */ (db.prepare(`PRAGMA table_info(orders)`).all()).map((c) => c.name),
    );
    for (const col of [
      'payment_asset',
      'sender_address',
      'refund_stellar_txid',
      'excess_usdc',
      'vcc_job_id',
      'vcc_payment_json',
      'metadata',
      'xlm_sent_at',
      'vcc_notified_at',
      'fulfillment_attempt',
      'request_id',
      'callback_nonce',
      'callback_secret',
      'expected_xlm_amount',
      'ctx_stellar_txid',
      'ctx_invoice_xlm',
      'settlement_xlm_usd_rate',
      'source',
      'mpp_challenge_id',
      'mpp_receipt_id',
    ]) {
      assert.ok(orderCols.has(col), `orders.${col} should exist`);
    }

    const keyCols = new Set(
      /** @type {any[]} */ (db.prepare(`PRAGMA table_info(api_keys)`).all()).map((c) => c.name),
    );
    for (const col of [
      'key_prefix',
      'webhook_secret',
      'default_webhook_url',
      'wallet_public_key',
      'suspended',
      'dashboard_id',
      'mode',
      'rate_limit_rpm',
      'expires_at',
      'last_used_at',
      'agent_state',
      'agent_state_at',
      'agent_state_detail',
    ]) {
      assert.ok(keyCols.has(col), `api_keys.${col} should exist`);
    }
  });
});

// ── Migration bookkeeping ─────────────────────────────────────────────────

describe('db.js — schema_migrations bookkeeping', () => {
  it('records every migration from 1 through EXPECTED_SCHEMA_VERSION', () => {
    const versions = /** @type {any[]} */ (
      db.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all()
    ).map((r) => r.version);
    assert.deepEqual(
      versions,
      Array.from({ length: EXPECTED_SCHEMA_VERSION }, (_, i) => i + 1),
      'every migration should be recorded exactly once, with no gaps',
    );
  });

  it('reports the expected schema version', () => {
    const row = /** @type {any} */ (
      db.prepare(`SELECT MAX(version) AS v FROM schema_migrations`).get()
    );
    assert.equal(row.v, EXPECTED_SCHEMA_VERSION);
  });

  it('stamps applied_at on every migration row', () => {
    const missing = /** @type {any} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM schema_migrations WHERE applied_at IS NULL`).get()
    ).n;
    assert.equal(missing, 0);
  });
});

// ── Schema: seed data ──────────────────────────────────────────────────────

describe('db.js — system_state seed rows', () => {
  it('seeds the frozen flag as 0', () => {
    const row = db.prepare(`SELECT value FROM system_state WHERE key = 'frozen'`).get();
    assert.ok(row, 'frozen row should exist');
    assert.equal(row.value, '0');
  });

  it('seeds consecutive_failures as 0', () => {
    const row = db
      .prepare(`SELECT value FROM system_state WHERE key = 'consecutive_failures'`)
      .get();
    assert.ok(row, 'consecutive_failures row should exist');
    assert.equal(row.value, '0');
  });
});

// ── orders table: CRUD ─────────────────────────────────────────────────────

describe('db.js — orders table queries', () => {
  beforeEach(() => resetDb());

  it('inserts and retrieves an order by id', () => {
    const id = insertOrder();
    const row = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
    assert.ok(row, 'inserted order should be retrievable');
    assert.equal(row.id, id);
    assert.equal(row.status, 'pending_payment');
    assert.equal(row.amount_usdc, '5.00');
  });

  it('defaults created_at and updated_at on insert', () => {
    const id = insertOrder();
    const row = db.prepare(`SELECT created_at, updated_at FROM orders WHERE id = ?`).get(id);
    assert.ok(row.created_at, 'created_at should be set');
    assert.ok(row.updated_at, 'updated_at should be set');
  });

  it('enforces PRIMARY KEY uniqueness on id', () => {
    const id = insertOrder();
    assert.throws(() => insertOrder({ id }), /UNIQUE constraint failed: orders\.id/);
  });

  it('allows updating order status', () => {
    const id = insertOrder();
    db.prepare(`UPDATE orders SET status = 'paid' WHERE id = ?`).run(id);
    const row = db.prepare(`SELECT status FROM orders WHERE id = ?`).get(id);
    assert.equal(row.status, 'paid');
  });

  it('returns undefined for a non-existent order id', () => {
    const row = db.prepare(`SELECT * FROM orders WHERE id = ?`).get('does-not-exist');
    assert.equal(row, undefined);
  });

  it('applies column defaults for status, failure_count, and source', () => {
    const id = uuidv4();
    db.prepare(`INSERT INTO orders (id, amount_usdc) VALUES (?, '1.00')`).run(id);
    const row = /** @type {any} */ (db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id));
    assert.equal(row.status, 'pending_payment');
    assert.equal(row.failure_count, 0);
    assert.equal(row.fulfillment_attempt, 0);
    // Migration 27 backfills every pre-existing row via the column
    // default, so a row created without an explicit source must land in
    // the classic bucket — platform revenue reporting splits on it.
    assert.equal(row.source, 'v1_orders');
    assert.equal(row.payment_asset, 'usdc');
  });

  it('rejects an order with a NULL amount_usdc', () => {
    assert.throws(
      () => db.prepare(`INSERT INTO orders (id, amount_usdc) VALUES (?, NULL)`).run(uuidv4()),
      /NOT NULL constraint failed: orders\.amount_usdc/,
    );
  });

  it('stores amount_usdc as TEXT without numeric coercion', () => {
    // Amounts are money and are deliberately TEXT — a REAL column would
    // round-trip "10.10" as 10.099999999999999. Guard the affinity so a
    // future ALTER can't silently change it.
    const id = uuidv4();
    db.prepare(`INSERT INTO orders (id, amount_usdc) VALUES (?, '10.10')`).run(id);
    const row = /** @type {any} */ (
      db.prepare(`SELECT amount_usdc FROM orders WHERE id = ?`).get(id)
    );
    assert.equal(typeof row.amount_usdc, 'string');
    assert.equal(row.amount_usdc, '10.10');
  });
});

// ── orders table: aggregate query shapes used by the HTTP surface ─────────

describe('db.js — orders aggregate queries', () => {
  beforeEach(() => resetDb());

  it('buckets orders by terminal status the way /status does', () => {
    insertOrder({ status: 'delivered' });
    insertOrder({ status: 'delivered' });
    insertOrder({ status: 'failed' });
    insertOrder({ status: 'refunded' });
    insertOrder({ status: 'expired' });
    insertOrder({ status: 'pending_payment' });

    const row = /** @type {any} */ (
      db
        .prepare(
          `SELECT
             SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
             SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed,
             SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) AS refunded,
             SUM(CASE WHEN status = 'expired'  THEN 1 ELSE 0 END) AS expired,
             COUNT(*) AS total
           FROM orders`,
        )
        .get()
    );
    assert.equal(row.delivered, 2);
    assert.equal(row.failed, 1);
    assert.equal(row.refunded, 1);
    assert.equal(row.expired, 1);
    assert.equal(row.total, 6);
  });

  it('returns NULL sums (not zero) on an empty orders table', () => {
    // The /status handler relies on `?? 0` to normalise this. Pinning
    // the raw SQLite behaviour documents why that coalesce exists — a
    // regression to `COUNT` semantics here would make the fallback dead
    // code and mask a real change.
    const row = /** @type {any} */ (
      db
        .prepare(
          `SELECT SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered
                  FROM orders`,
        )
        .get()
    );
    assert.equal(row.delivered, null);
  });

  it('COALESCE keeps the /v1/usage counters at 0 for a key with no orders', () => {
    const apiKeyId = insertApiKey();
    const row = /** @type {any} */ (
      db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
             COALESCE(SUM(CASE WHEN status NOT IN
               ('delivered','failed','refunded','expired','rejected')
               THEN 1 ELSE 0 END), 0) AS in_progress
           FROM orders WHERE api_key_id = ?`,
        )
        .get(apiKeyId)
    );
    assert.equal(row.total, 0);
    assert.equal(row.delivered, 0);
    assert.equal(row.in_progress, 0);
  });

  it('excludes expired and rejected orders from the in_progress bucket', () => {
    const apiKeyId = insertApiKey();
    insertOrder({ apiKeyId, status: 'expired' });
    insertOrder({ apiKeyId, status: 'rejected' });
    insertOrder({ apiKeyId, status: 'ordering' });
    const row = /** @type {any} */ (
      db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN status NOT IN
             ('delivered','failed','refunded','expired','rejected')
             THEN 1 ELSE 0 END), 0) AS in_progress
           FROM orders WHERE api_key_id = ?`,
        )
        .get(apiKeyId)
    );
    assert.equal(row.in_progress, 1);
  });

  it('filters by an ISO created_at window without lexical surprises', () => {
    // created_at is stored as an ISO-8601 string, so the 24h window
    // filter on /status is a plain lexical comparison. That only works
    // because ISO-8601 sorts lexically the same way it sorts
    // chronologically — worth pinning.
    const oldId = uuidv4();
    const newId = uuidv4();
    db.prepare(
      `INSERT INTO orders (id, amount_usdc, created_at) VALUES (?, '1.00', '2020-01-01T00:00:00.000Z')`,
    ).run(oldId);
    db.prepare(
      `INSERT INTO orders (id, amount_usdc, created_at) VALUES (?, '1.00', '2099-01-01T00:00:00.000Z')`,
    ).run(newId);

    const since = new Date().toISOString();
    const rows = /** @type {any[]} */ (
      db.prepare(`SELECT id FROM orders WHERE created_at >= ?`).all(since)
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [newId],
    );
  });

  it('sums in-flight spend per api key the way the spend-limit check does', () => {
    const apiKeyId = insertApiKey();
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, api_key_id) VALUES (?, 'pending_payment', '10.50', ?)`,
    ).run(uuidv4(), apiKeyId);
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, api_key_id) VALUES (?, 'awaiting_approval', '4.50', ?)`,
    ).run(uuidv4(), apiKeyId);
    db.prepare(
      `INSERT INTO orders (id, status, amount_usdc, api_key_id) VALUES (?, 'expired', '99.00', ?)`,
    ).run(uuidv4(), apiKeyId);

    const row = /** @type {any} */ (
      db
        .prepare(
          `SELECT COALESCE(SUM(CAST(amount_usdc AS REAL)), 0) AS total
           FROM orders
           WHERE api_key_id = ? AND status IN ('pending_payment','awaiting_approval','ordering')`,
        )
        .get(apiKeyId)
    );
    assert.equal(row.total, 15);
  });
});

// ── api_keys table: constraints ────────────────────────────────────────────

describe('db.js — api_keys table queries', () => {
  beforeEach(() => resetDb());

  it('inserts and retrieves an api key', () => {
    const id = insertApiKey({ label: 'my-key' });
    const row = db.prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id);
    assert.ok(row);
    assert.equal(row.label, 'my-key');
    assert.equal(row.enabled, 1);
  });

  it('enforces UNIQUE constraint on key_hash', () => {
    const sharedHash = `hash-${uuidv4()}`;
    insertApiKey({ keyHash: sharedHash });
    assert.throws(
      () => insertApiKey({ keyHash: sharedHash }),
      /UNIQUE constraint failed: api_keys\.key_hash/,
    );
  });

  it('defaults total_spent_usdc to "0"', () => {
    const id = insertApiKey();
    const row = db.prepare(`SELECT total_spent_usdc FROM api_keys WHERE id = ?`).get(id);
    assert.equal(row.total_spent_usdc, '0');
  });

  it('defaults mode to live and suspended to 0', () => {
    const id = insertApiKey();
    const row = /** @type {any} */ (
      db.prepare(`SELECT mode, suspended, enabled FROM api_keys WHERE id = ?`).get(id)
    );
    assert.equal(row.mode, 'live');
    assert.equal(row.suspended, 0);
    assert.equal(row.enabled, 1);
  });

  it('rejects a NULL key_hash', () => {
    assert.throws(
      () => db.prepare(`INSERT INTO api_keys (id, key_hash) VALUES (?, NULL)`).run(uuidv4()),
      /NOT NULL constraint failed: api_keys\.key_hash/,
    );
  });

  it('indexes key_prefix so the auth middleware O(1) lookup resolves', () => {
    const id = insertApiKey();
    db.prepare(`UPDATE api_keys SET key_prefix = 'abc123def456' WHERE id = ?`).run(id);
    const row = /** @type {any} */ (
      db.prepare(`SELECT id FROM api_keys WHERE key_prefix = ?`).get('abc123def456')
    );
    assert.equal(row.id, id);
  });
});

// ── Referential integrity ─────────────────────────────────────────────────
//
// `foreign_keys = ON` is set in db.js. These tests prove the pragma is
// actually doing work — a pragma that silently fails to apply (it is a
// per-connection setting, easy to lose in a refactor) would let orphan
// sessions and dangling dashboard references accumulate unnoticed.

describe('db.js — foreign key enforcement', () => {
  beforeEach(() => {
    resetDb();
    db.prepare(`DELETE FROM dashboards`).run();
  });

  function insertUser(email = `${uuidv4()}@example.test`) {
    const id = uuidv4();
    db.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run(id, email);
    return id;
  }

  it('rejects a session pointing at a non-existent user', () => {
    assert.throws(
      () =>
        db
          .prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?,?,?,?)`)
          .run(uuidv4(), 'no-such-user', `hash-${uuidv4()}`, '2099-01-01T00:00:00.000Z'),
      /FOREIGN KEY constraint failed/,
    );
  });

  it('cascades session deletion when the owning user is removed', () => {
    const userId = insertUser();
    db.prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?,?,?,?)`).run(
      uuidv4(),
      userId,
      `hash-${uuidv4()}`,
      '2099-01-01T00:00:00.000Z',
    );
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    const remaining = /** @type {any} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(userId)
    ).n;
    assert.equal(remaining, 0);
  });

  it('cascades dashboard deletion when the owning user is removed', () => {
    const userId = insertUser();
    const dashId = uuidv4();
    db.prepare(`INSERT INTO dashboards (id, user_id) VALUES (?, ?)`).run(dashId, userId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    const row = db.prepare(`SELECT id FROM dashboards WHERE id = ?`).get(dashId);
    assert.equal(row, undefined);
  });

  it('rejects an api key pointing at a non-existent dashboard', () => {
    assert.throws(
      () =>
        db
          .prepare(`INSERT INTO api_keys (id, key_hash, dashboard_id) VALUES (?, ?, ?)`)
          .run(uuidv4(), `hash-${uuidv4()}`, 'no-such-dashboard'),
      /FOREIGN KEY constraint failed/,
    );
  });

  it('allows a NULL dashboard_id on an api key', () => {
    // Pre-multi-tenancy keys and the MPP anonymous sentinel both carry a
    // NULL dashboard_id; the FK must stay nullable.
    const id = uuidv4();
    db.prepare(`INSERT INTO api_keys (id, key_hash, dashboard_id) VALUES (?, ?, NULL)`).run(
      id,
      `hash-${uuidv4()}`,
    );
    const row = /** @type {any} */ (
      db.prepare(`SELECT dashboard_id FROM api_keys WHERE id = ?`).get(id)
    );
    assert.equal(row.dashboard_id, null);
  });
});

// ── Unique / partial indexes ──────────────────────────────────────────────

describe('db.js — unique and partial indexes', () => {
  beforeEach(() => {
    resetDb();
    db.prepare(`DELETE FROM mpp_challenges`).run();
  });

  function insertChallenge(fields = {}) {
    const id = fields.id || uuidv4();
    db.prepare(
      `INSERT INTO mpp_challenges (id, resource_path, amount_usdc, expires_at, redeemed_tx_hash)
       VALUES (?, '/v1/cards/visa/10', '10.00', '2099-01-01T00:00:00.000Z', ?)`,
    ).run(id, fields.redeemedTxHash ?? null);
    return id;
  }

  it('rejects two challenges redeemed by the same Stellar tx hash', () => {
    insertChallenge({ redeemedTxHash: 'tx-hash-1' });
    assert.throws(
      () => insertChallenge({ redeemedTxHash: 'tx-hash-1' }),
      /UNIQUE constraint failed/,
    );
  });

  it('allows many unredeemed challenges (partial index skips NULLs)', () => {
    insertChallenge();
    insertChallenge();
    insertChallenge();
    const n = /** @type {any} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM mpp_challenges WHERE redeemed_tx_hash IS NULL`).get()
    ).n;
    assert.equal(n, 3);
  });

  it('binds at most one order to a given mpp_challenge_id', () => {
    const challengeId = insertChallenge();
    db.prepare(`INSERT INTO orders (id, amount_usdc, mpp_challenge_id) VALUES (?, '1.00', ?)`).run(
      uuidv4(),
      challengeId,
    );
    assert.throws(
      () =>
        db
          .prepare(`INSERT INTO orders (id, amount_usdc, mpp_challenge_id) VALUES (?, '1.00', ?)`)
          .run(uuidv4(), challengeId),
      /UNIQUE constraint failed/,
    );
  });

  it('allows many orders with a NULL mpp_challenge_id', () => {
    insertOrder();
    insertOrder();
    const n = /** @type {any} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE mpp_challenge_id IS NULL`).get()
    ).n;
    assert.equal(n, 2);
  });

  it('rejects a duplicate mpp_receipt_id', () => {
    db.prepare(`INSERT INTO orders (id, amount_usdc, mpp_receipt_id) VALUES (?, '1.00', ?)`).run(
      uuidv4(),
      'rcpt_1',
    );
    assert.throws(
      () =>
        db
          .prepare(`INSERT INTO orders (id, amount_usdc, mpp_receipt_id) VALUES (?, '1.00', ?)`)
          .run(uuidv4(), 'rcpt_1'),
      /UNIQUE constraint failed/,
    );
  });

  it('rejects a duplicate agent claim code', () => {
    const apiKeyId = insertApiKey();
    const insert = (code) =>
      db
        .prepare(
          `INSERT INTO agent_claims (id, code, api_key_id, sealed_payload, expires_at)
           VALUES (?, ?, ?, 'sealed', '2099-01-01T00:00:00.000Z')`,
        )
        .run(uuidv4(), code, apiKeyId);
    insert('code-hash-1');
    assert.throws(() => insert('code-hash-1'), /UNIQUE constraint failed: agent_claims\.code/);
  });

  it('creates every index the migration chain declares', () => {
    const names = new Set(
      /** @type {any[]} */ (
        db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'`).all()
      ).map((r) => r.name),
    );
    for (const idx of [
      'idx_orders_status',
      'idx_orders_api_key_id',
      'idx_orders_created_at',
      'idx_orders_updated_at',
      'idx_orders_stellar_txid',
      'idx_orders_api_key_status',
      'idx_orders_api_key_created_at',
      'idx_orders_vcc_job_id',
      'idx_api_keys_key_prefix',
      'idx_api_keys_dashboard_id',
      'idx_webhook_queue_next',
      'idx_sessions_token',
      'idx_sessions_user',
      'idx_users_email',
      'idx_auth_codes_email',
      'idx_audit_log_dashboard',
      'idx_unmatched_payments_pending',
      'idx_unmatched_payments_created_at',
      'idx_stellar_dead_letter_created_at',
      'idx_mpp_challenges_expires',
      'idx_mpp_challenges_tx_hash',
    ]) {
      assert.ok(names.has(idx), `${idx} should exist`);
    }
  });

  it('plans the per-key spend query through an index, not a table scan', () => {
    // Migration 24 exists specifically so this query stops scanning every
    // order a key has ever created. Asserting on the query plan is the
    // only way to catch an index being dropped — the query keeps
    // returning correct results either way, it just gets slower as the
    // table grows.
    const plan = /** @type {any[]} */ (
      db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT SUM(CAST(amount_usdc AS REAL)) FROM orders
           WHERE api_key_id = ? AND status IN ('pending_payment','ordering')`,
        )
        .all('some-key')
    );
    const detail = plan.map((r) => r.detail).join(' | ');
    assert.match(detail, /USING (COVERING )?INDEX idx_orders_api_key/, detail);
  });
});

// ── Transaction semantics ─────────────────────────────────────────────────
//
// db.js hands the raw better-sqlite3 handle to callers, and several call
// sites (the agent-claim redemption in app.js, order creation in
// api/orders.js, applyMigration in db.js itself) depend on
// `db.transaction(fn)` rolling back every write when `fn` throws.

describe('db.js — transaction semantics', () => {
  beforeEach(() => resetDb());

  it('rolls back every write when the transaction body throws', () => {
    const id = uuidv4();
    const tx = db.transaction(() => {
      db.prepare(`INSERT INTO orders (id, amount_usdc) VALUES (?, '1.00')`).run(id);
      throw new Error('boom');
    });
    assert.throws(() => tx(), /boom/);
    assert.equal(db.prepare(`SELECT id FROM orders WHERE id = ?`).get(id), undefined);
  });

  it('commits every write when the transaction body returns', () => {
    const first = uuidv4();
    const second = uuidv4();
    db.transaction(() => {
      db.prepare(`INSERT INTO orders (id, amount_usdc) VALUES (?, '1.00')`).run(first);
      db.prepare(`INSERT INTO orders (id, amount_usdc) VALUES (?, '2.00')`).run(second);
    })();
    const n = /** @type {any} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE id IN (?, ?)`).get(first, second)
    ).n;
    assert.equal(n, 2);
  });

  it('propagates the transaction body return value to the caller', () => {
    const result = db.transaction((amount) => ({ ok: true, amount }))('7.00');
    assert.deepEqual(result, { ok: true, amount: '7.00' });
  });

  it('rolls back a constraint violation mid-transaction', () => {
    const id = uuidv4();
    insertOrder({ id });
    const tx = db.transaction(() => {
      db.prepare(`UPDATE orders SET status = 'delivered' WHERE id = ?`).run(id);
      // Duplicate primary key — SQLite raises, better-sqlite3 rolls back.
      db.prepare(`INSERT INTO orders (id, amount_usdc) VALUES (?, '1.00')`).run(id);
    });
    assert.throws(() => tx(), /UNIQUE constraint failed/);
    const row = /** @type {any} */ (db.prepare(`SELECT status FROM orders WHERE id = ?`).get(id));
    assert.equal(row.status, 'pending_payment', 'the UPDATE must have rolled back too');
  });
});

// ── idempotency_keys table: composite PK ─────────────────────────────────

describe('db.js — idempotency_keys table queries', () => {
  beforeEach(() => resetDb());

  it('inserts and retrieves an idempotency key', () => {
    const apiKeyId = insertApiKey();
    db.prepare(
      `INSERT INTO idempotency_keys (key, api_key_id, request_fingerprint, response_status, response_body)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('idem-key-1', apiKeyId, 'fp-abc', 201, '{"id":"order-1"}');

    const row = db
      .prepare(`SELECT * FROM idempotency_keys WHERE key = ? AND api_key_id = ?`)
      .get('idem-key-1', apiKeyId);
    assert.ok(row);
    assert.equal(row.response_status, 201);
    assert.equal(row.response_body, '{"id":"order-1"}');
  });

  it('enforces composite PRIMARY KEY (key, api_key_id)', () => {
    const apiKeyId = insertApiKey();
    db.prepare(
      `INSERT INTO idempotency_keys (key, api_key_id, request_fingerprint, response_status, response_body)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('idem-dup', apiKeyId, 'fp', 200, '{}');

    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO idempotency_keys (key, api_key_id, request_fingerprint, response_status, response_body)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('idem-dup', apiKeyId, 'fp', 200, '{}'),
      /UNIQUE constraint failed/,
    );
  });

  it('allows the same key for different api_key_ids', () => {
    const id1 = insertApiKey();
    const id2 = insertApiKey();
    db.prepare(
      `INSERT INTO idempotency_keys (key, api_key_id, request_fingerprint, response_status, response_body)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('shared-key', id1, 'fp', 200, '{}');
    db.prepare(
      `INSERT INTO idempotency_keys (key, api_key_id, request_fingerprint, response_status, response_body)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('shared-key', id2, 'fp', 200, '{}');

    const rows = db
      .prepare(`SELECT api_key_id FROM idempotency_keys WHERE key = 'shared-key'`)
      .all();
    assert.equal(rows.length, 2);
  });
});

// ── Pragma enforcement ────────────────────────────────────────────────────

describe('db.js — pragma settings', () => {
  it('foreign keys pragma is ON', () => {
    const row = /** @type {any} */ (db.prepare(`PRAGMA foreign_keys`).get());
    assert.equal(row.foreign_keys, 1);
  });

  it('busy_timeout is set so writer contention waits instead of throwing', () => {
    const row = /** @type {any} */ (db.prepare(`PRAGMA busy_timeout`).get());
    assert.equal(row.timeout, 5000);
  });
});

// ── Fresh on-disk instance ────────────────────────────────────────────────
//
// SQLite refuses to put a `:memory:` database into WAL mode — the
// `journal_mode = wal` pragma in db.js is silently downgraded to
// `memory`, so the shared in-memory handle used above cannot observe it.
// The same goes for migration idempotency, which by definition needs the
// database to survive a process boundary. These tests boot db.js in a
// child process against a real file.

describe('db.js — fresh on-disk instance', () => {
  /** @type {string} */ let tmpDir;
  /** @type {string} */ let dbPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-card-db-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('opens the database in WAL journal mode', () => {
    const journalMode = bootFreshDb(dbPath, `db.pragma('journal_mode', { simple: true })`);
    assert.equal(journalMode, 'wal');
  });

  it('applies busy_timeout and foreign_keys on a real connection', () => {
    const pragmas = bootFreshDb(
      dbPath,
      `({
        busy: db.pragma('busy_timeout', { simple: true }),
        fk: db.pragma('foreign_keys', { simple: true }),
      })`,
    );
    assert.equal(pragmas.busy, 5000);
    assert.equal(pragmas.fk, 1);
  });

  it('runs the full migration chain on a brand-new database file', () => {
    const freshPath = path.join(tmpDir, 'brand-new.db');
    const version = bootFreshDb(
      freshPath,
      `db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v`,
    );
    assert.equal(version, EXPECTED_SCHEMA_VERSION);
  });

  it('seeds the MPP anonymous api key as permanently disabled', () => {
    const freshPath = path.join(tmpDir, 'mpp-seed.db');
    const row = bootFreshDb(
      freshPath,
      `db.prepare("SELECT id, enabled, key_hash FROM api_keys WHERE id = 'mpp-anonymous'").get()`,
    );
    assert.ok(row, 'the mpp-anonymous seed row should exist');
    assert.equal(row.enabled, 0, 'the sentinel key must never authenticate');
    // A bcrypt hash always starts with "$2"; the sentinel deliberately
    // cannot be produced by bcrypt, so no X-Api-Key input can match it.
    assert.ok(!row.key_hash.startsWith('$2'), 'sentinel hash must not look like a bcrypt hash');
  });

  it('seeds the system_state defaults on a brand-new database file', () => {
    const freshPath = path.join(tmpDir, 'seed-state.db');
    const rows = bootFreshDb(
      freshPath,
      `db.prepare("SELECT key, value FROM system_state ORDER BY key").all()`,
    );
    assert.deepEqual(rows, [
      { key: 'consecutive_failures', value: '0' },
      { key: 'frozen', value: '0' },
    ]);
  });

  it('is idempotent — reopening the same file re-applies nothing', () => {
    const reopenPath = path.join(tmpDir, 'reopen.db');
    const first = bootFreshDb(
      reopenPath,
      `db.prepare('SELECT COUNT(*) AS n, MAX(version) AS v FROM schema_migrations').get()`,
    );
    const second = bootFreshDb(
      reopenPath,
      `db.prepare('SELECT COUNT(*) AS n, MAX(version) AS v FROM schema_migrations').get()`,
    );
    assert.equal(first.v, EXPECTED_SCHEMA_VERSION);
    assert.deepEqual(second, first, 'a second boot must not add migration rows');
  });

  it('does not clobber the system_state values written by a previous boot', () => {
    const persistPath = path.join(tmpDir, 'persist.db');
    bootFreshDb(
      persistPath,
      `db.prepare("UPDATE system_state SET value = '1' WHERE key = 'frozen'").run().changes`,
    );
    const value = bootFreshDb(
      persistPath,
      `db.prepare("SELECT value FROM system_state WHERE key = 'frozen'").get().value`,
    );
    assert.equal(value, '1', 'the frozen flag must survive a restart');
  });

  it('refuses to start against a database newer than the code understands', () => {
    // db.js exits(1) when the on-disk schema is ahead of
    // EXPECTED_SCHEMA_VERSION — running an old binary against a
    // rolled-forward database is the one drift direction that can
    // silently corrupt data, so it must be fatal rather than a warning.
    const futurePath = path.join(tmpDir, 'future.db');
    bootFreshDb(
      futurePath,
      `db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(${
        EXPECTED_SCHEMA_VERSION + 1
      }).changes`,
    );
    assert.throws(
      () => bootFreshDb(futurePath, `1`),
      (err) => {
        assert.equal(/** @type {any} */ (err).status, 1, 'process should exit(1)');
        assert.match(String(/** @type {any} */ (err).stderr), /schema version mismatch/);
        return true;
      },
    );
  });
});

// ── Issue #28 (Part 3): coverage for tables that previously had none ──────
//
// db.js defines 21 tables; before this change only orders/api_keys/
// idempotency_keys had query-level tests (schema/seed/pragma checks
// covered a few more by table-existence alone). This adds CRUD + constraint
// coverage for the auth path (users/auth_codes/sessions — the tables that
// back every login) plus audit_log and webhook_deliveries (the two
// append-only tables the dashboard's security/observability surfaces read
// from). The remaining untested tables (admin_actions, agent_claims,
// alert_firings, alert_rules, approval_requests, dashboards,
// mpp_challenges, policy_decisions, stellar_dead_letter,
// unmatched_payments, schema_migrations) are follow-up work — each needs
// its own careful read of the owning module's insert shape, which wasn't
// rushed here for the sake of covering more tables shallowly.

function insertUser({ id = uuidv4(), email = `user-${uuidv4()}@example.com`, role = 'user' } = {}) {
  db.prepare(`INSERT INTO users (id, email, role) VALUES (?, ?, ?)`).run(id, email, role);
  return id;
}

describe('db.js — users table queries', () => {
  beforeEach(() => resetDb());

  it('inserts and retrieves a user by id', () => {
    const id = insertUser({ email: 'alice@example.com', role: 'owner' });
    const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    assert.ok(row);
    assert.equal(row.email, 'alice@example.com');
    assert.equal(row.role, 'owner');
  });

  it('defaults role to "user"', () => {
    const id = uuidv4();
    db.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run(id, 'bob@example.com');
    const row = db.prepare(`SELECT role FROM users WHERE id = ?`).get(id);
    assert.equal(row.role, 'user');
  });

  it('enforces UNIQUE constraint on email', () => {
    insertUser({ email: 'dup@example.com' });
    assert.throws(
      () => insertUser({ email: 'dup@example.com' }),
      /UNIQUE constraint failed: users\.email/,
    );
  });

  it('defaults created_at and leaves last_login_at null', () => {
    const id = insertUser();
    const row = db.prepare(`SELECT created_at, last_login_at FROM users WHERE id = ?`).get(id);
    assert.ok(row.created_at);
    assert.equal(row.last_login_at, null);
  });
});

describe('db.js — auth_codes table queries', () => {
  beforeEach(() => resetDb());

  it('inserts and retrieves an auth code by email', () => {
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO auth_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)`,
    ).run(id, 'alice@example.com', 'hashed-code', expiresAt);

    const rows = db.prepare(`SELECT * FROM auth_codes WHERE email = ?`).all('alice@example.com');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].used_at, null);
  });

  it('marking a code used sets used_at', () => {
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO auth_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)`,
    ).run(id, 'alice@example.com', 'hashed-code', expiresAt);

    db.prepare(`UPDATE auth_codes SET used_at = datetime('now') WHERE id = ?`).run(id);
    const row = db.prepare(`SELECT used_at FROM auth_codes WHERE id = ?`).get(id);
    assert.ok(row.used_at);
  });
});

describe('db.js — sessions table queries', () => {
  beforeEach(() => resetDb());

  it('inserts a session referencing a valid user', () => {
    const userId = insertUser();
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
    ).run(sessionId, userId, 'hashed-token', expiresAt);

    const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    assert.ok(row);
    assert.equal(row.user_id, userId);
  });

  it('enforces UNIQUE constraint on token_hash', () => {
    const userId = insertUser();
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
    ).run(uuidv4(), userId, 'dup-token', expiresAt);

    assert.throws(
      () =>
        db
          .prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`)
          .run(uuidv4(), userId, 'dup-token', expiresAt),
      /UNIQUE constraint failed: sessions\.token_hash/,
    );
  });

  it('deletes sessions when the owning user is deleted (ON DELETE CASCADE)', () => {
    const userId = insertUser();
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    db.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
    ).run(sessionId, userId, 'token-to-cascade', expiresAt);

    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    assert.equal(row, undefined, 'session should be cascade-deleted with its user');
  });

  it('rejects a session for a non-existent user_id (foreign key enforcement)', () => {
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    assert.throws(
      () =>
        db
          .prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`)
          .run(uuidv4(), 'no-such-user', 'orphan-token', expiresAt),
      /FOREIGN KEY constraint failed/,
    );
  });
});

describe('db.js — audit_log table queries', () => {
  beforeEach(() => resetDb());

  it('inserts and retrieves an audit entry', () => {
    db.prepare(
      `INSERT INTO audit_log (dashboard_id, actor_email, actor_role, action)
       VALUES (?, ?, ?, ?)`,
    ).run('dash-1', 'owner@example.com', 'owner', 'api_key.create');

    const rows = db.prepare(`SELECT * FROM audit_log WHERE dashboard_id = ?`).all('dash-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'api_key.create');
    assert.ok(rows[0].created_at);
  });

  it('id auto-increments across inserts (append-only ordering)', () => {
    const insert = () =>
      db
        .prepare(
          `INSERT INTO audit_log (dashboard_id, actor_email, actor_role, action)
           VALUES ('dash-1', 'owner@example.com', 'owner', 'noop')`,
        )
        .run().lastInsertRowid;
    const first = insert();
    const second = insert();
    assert.ok(second > first);
  });
});

describe('db.js — webhook_deliveries table queries', () => {
  beforeEach(() => resetDb());

  it('inserts and retrieves a delivery attempt', () => {
    db.prepare(
      `INSERT INTO webhook_deliveries (dashboard_id, url, response_status, latency_ms)
       VALUES (?, ?, ?, ?)`,
    ).run('dash-1', 'https://example.com/hook', 200, 42);

    const row = db
      .prepare(`SELECT * FROM webhook_deliveries WHERE dashboard_id = ?`)
      .get('dash-1');
    assert.ok(row);
    assert.equal(row.method, 'POST', 'method should default to POST');
    assert.equal(row.response_status, 200);
  });

  it('orders deliveries by created_at DESC for the dashboard feed query', () => {
    const insertAt = (url) =>
      db
        .prepare(`INSERT INTO webhook_deliveries (dashboard_id, url) VALUES ('dash-1', ?)`)
        .run(url).lastInsertRowid;
    insertAt('https://example.com/first');
    insertAt('https://example.com/second');

    const rows = db
      .prepare(
        `SELECT url FROM webhook_deliveries WHERE dashboard_id = 'dash-1' ORDER BY id DESC`,
      )
      .all();
    assert.equal(rows[0].url, 'https://example.com/second');
    assert.equal(rows[1].url, 'https://example.com/first');
  });
});
