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
    db.prepare(`INSERT INTO auth_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)`).run(
      id,
      'alice@example.com',
      'hashed-code',
      expiresAt,
    );

    const rows = db.prepare(`SELECT * FROM auth_codes WHERE email = ?`).all('alice@example.com');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].used_at, null);
  });

  it('marking a code used sets used_at', () => {
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO auth_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)`).run(
      id,
      'alice@example.com',
      'hashed-code',
      expiresAt,
    );

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

    const row = db.prepare(`SELECT * FROM webhook_deliveries WHERE dashboard_id = ?`).get('dash-1');
    assert.ok(row);
    assert.equal(row.method, 'POST', 'method should default to POST');
    assert.equal(row.response_status, 200);
  });

  it('orders deliveries by created_at DESC for the dashboard feed query', () => {
    const insertAt = (url) =>
      db.prepare(`INSERT INTO webhook_deliveries (dashboard_id, url) VALUES ('dash-1', ?)`).run(url)
        .lastInsertRowid;
    insertAt('https://example.com/first');
    insertAt('https://example.com/second');

    const rows = db
      .prepare(`SELECT url FROM webhook_deliveries WHERE dashboard_id = 'dash-1' ORDER BY id DESC`)
      .all();
    assert.equal(rows[0].url, 'https://example.com/second');
    assert.equal(rows[1].url, 'https://example.com/first');
  });
});

// ── The retry queue ───────────────────────────────────────────────────────
//
// webhook_queue is the one table where a query-shape regression is
// invisible: a scan that picks up too few rows silently drops customer
// webhooks, and one that picks up too many re-fires deliveries that
// already succeeded. Neither changes a function signature and neither
// throws. These pin the two predicates that decide which rows move.

function queueWebhook({
  id = uuidv4(),
  url = 'https://example.com/hook',
  attempts = 0,
  nextAttempt = new Date().toISOString(),
  delivered = 0,
} = {}) {
  db.prepare(
    `INSERT INTO webhook_queue (id, url, payload, attempts, next_attempt, delivered)
     VALUES (?, ?, '{}', ?, ?, ?)`,
  ).run(id, url, attempts, nextAttempt, delivered);
  return id;
}

describe('db.js — webhook_queue table queries', () => {
  const MAX_WEBHOOK_ATTEMPTS = 3;

  beforeEach(() => resetDb());

  /** The exact scan jobs.js::retryWebhooks runs on every cycle. */
  function dueRows(now) {
    return db
      .prepare(
        `SELECT id FROM webhook_queue
         WHERE delivered = 0 AND attempts <= ? AND next_attempt <= ?`,
      )
      .all(MAX_WEBHOOK_ATTEMPTS, now);
  }

  it('applies the defaults a freshly-queued delivery relies on', () => {
    db.prepare(
      `INSERT INTO webhook_queue (id, url, payload, next_attempt)
       VALUES ('w1', 'https://example.com/hook', '{}', '2026-01-01T00:00:00.000Z')`,
    ).run();

    const row = db.prepare(`SELECT * FROM webhook_queue WHERE id = 'w1'`).get();
    assert.equal(row.attempts, 0, 'a new row must start at zero attempts');
    assert.equal(row.delivered, 0, 'a new row must start undelivered');
    assert.equal(row.secret, null);
    assert.equal(row.last_error, null);
    assert.ok(row.created_at, 'created_at defaults to datetime(now)');
  });

  it('rejects a queued row with no destination or payload', () => {
    // Both are NOT NULL: a row missing either is a delivery that can
    // never fire but keeps getting scanned.
    assert.throws(
      () =>
        db
          .prepare(`INSERT INTO webhook_queue (id, url, payload, next_attempt) VALUES (?,?,?,?)`)
          .run('w-null-url', null, '{}', '2026-01-01T00:00:00.000Z'),
      /NOT NULL/,
    );
    assert.throws(
      () =>
        db
          .prepare(`INSERT INTO webhook_queue (id, url, payload, next_attempt) VALUES (?,?,?,?)`)
          .run('w-null-payload', 'https://example.com', null, '2026-01-01T00:00:00.000Z'),
      /NOT NULL/,
    );
  });

  it('picks up only rows that are undelivered, under the cap, and due', () => {
    const now = '2026-01-01T12:00:00.000Z';
    const due = queueWebhook({ nextAttempt: '2026-01-01T11:00:00.000Z' });
    queueWebhook({ nextAttempt: '2026-01-01T13:00:00.000Z' }); // not due yet
    queueWebhook({ nextAttempt: '2026-01-01T11:00:00.000Z', delivered: 1 }); // done
    queueWebhook({ nextAttempt: '2026-01-01T11:00:00.000Z', attempts: 4 }); // abandoned

    const ids = dueRows(now).map((r) => r.id);
    assert.deepEqual(ids, [due]);
  });

  it('treats next_attempt as inclusive, so a row due exactly now fires', () => {
    const now = '2026-01-01T12:00:00.000Z';
    const exact = queueWebhook({ nextAttempt: now });
    assert.deepEqual(
      dueRows(now).map((r) => r.id),
      [exact],
    );
  });

  it('compares next_attempt lexically, which only sorts for ISO-8601', () => {
    // The column is TEXT and the comparison is a string comparison. A
    // non-ISO timestamp does not sort chronologically, so a row written
    // with one is either permanently due or permanently invisible —
    // this pins that the queue writers must keep using toISOString().
    queueWebhook({ id: 'iso', nextAttempt: '2026-01-01T11:00:00.000Z' });
    queueWebhook({ id: 'human', nextAttempt: 'Jan 1 2026 11:00' });

    const ids = dueRows('2026-01-01T12:00:00.000Z').map((r) => r.id);
    assert.deepEqual(ids, ['iso'], 'a non-ISO next_attempt sorts above every ISO timestamp');
  });

  it('marks a row delivered without disturbing its attempt history', () => {
    const id = queueWebhook({ attempts: 2 });
    db.prepare(`UPDATE webhook_queue SET delivered = 1 WHERE id = ?`).run(id);

    const row = db.prepare(`SELECT * FROM webhook_queue WHERE id = ?`).get(id);
    assert.equal(row.delivered, 1);
    assert.equal(row.attempts, 2, 'attempts is forensic history, not a live counter');
    assert.equal(dueRows('2030-01-01T00:00:00.000Z').length, 0);
  });

  it('counts permanently-failed deliveries the way /status does', () => {
    // jobs.js pushes attempts past MAX_WEBHOOK_ATTEMPTS to abandon a
    // delivery; /status reports how many of those landed in the last
    // 24h. Before that counter existed, an abandoned webhook was only
    // visible by querying this table by hand.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    queueWebhook({ attempts: MAX_WEBHOOK_ATTEMPTS + 1 });
    queueWebhook({ attempts: MAX_WEBHOOK_ATTEMPTS + 1 });
    queueWebhook({ attempts: MAX_WEBHOOK_ATTEMPTS + 1, delivered: 1 }); // recovered
    queueWebhook({ attempts: 1 }); // still retrying

    const n = db
      .prepare(
        `SELECT COUNT(*) AS n FROM webhook_queue
         WHERE delivered = 0 AND attempts > ? AND created_at >= ?`,
      )
      .get(MAX_WEBHOOK_ATTEMPTS, since).n;
    assert.equal(n, 2);
  });

  it('plans the retry scan through idx_webhook_queue_next', () => {
    // The scan runs on every job cycle over a table that only grows.
    // A dropped index turns it into a full scan that degrades silently.
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT * FROM webhook_queue
         WHERE delivered = 0 AND attempts <= ? AND next_attempt <= ?`,
      )
      .all(MAX_WEBHOOK_ATTEMPTS, '2026-01-01T00:00:00.000Z');
    const detail = plan.map((r) => r.detail).join(' ');
    assert.match(detail, /idx_webhook_queue_next/, `expected an index scan, got: ${detail}`);
  });
});

// ── The expiry predicate ──────────────────────────────────────────────────
//
// Three separate single-use credentials — login codes, agent claim codes,
// and MPP challenges — are all gated on the same SQL shape:
//
//   WHERE used_at IS NULL AND datetime(expires_at) > datetime('now')
//
// Its failure mode is quiet in both directions. `datetime()` returns NULL
// for anything it cannot parse, and a NULL comparison is NULL rather than
// false, so a malformed expires_at makes a credential permanently
// unredeemable instead of raising. Getting the comparison the other way
// round makes an expired credential redeemable forever.

describe('db.js — credential expiry semantics', () => {
  beforeEach(() => resetDb());

  const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

  function insertAuthCode({ email = 'user@example.com', codeHash = uuidv4(), expiresAt } = {}) {
    db.prepare(`INSERT INTO auth_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)`).run(
      uuidv4(),
      email,
      codeHash,
      expiresAt,
    );
    return codeHash;
  }

  /** The redemption UPDATE from POST /auth/verify, verbatim. */
  function redeemAuthCode(email, codeHash) {
    return db
      .prepare(
        `UPDATE auth_codes SET used_at = ?
         WHERE email = ? AND code_hash = ?
           AND used_at IS NULL
           AND datetime(expires_at) > datetime('now')`,
      )
      .run(new Date().toISOString(), email, codeHash);
  }

  it('redeems a live, unused code exactly once', () => {
    const hash = insertAuthCode({ expiresAt: future() });
    assert.equal(redeemAuthCode('user@example.com', hash).changes, 1);
    assert.equal(
      redeemAuthCode('user@example.com', hash).changes,
      0,
      'the used_at IS NULL clause is what makes redemption single-use',
    );
  });

  it('refuses an expired code', () => {
    const hash = insertAuthCode({ expiresAt: past() });
    assert.equal(redeemAuthCode('user@example.com', hash).changes, 0);
  });

  it('refuses a code whose expires_at datetime() cannot parse', () => {
    // NULL > datetime('now') is NULL, not true — so the row is excluded.
    // Failing closed is the correct direction, and this test is here so
    // a future rewrite to `expires_at > datetime('now')` (a lexical
    // comparison, which WOULD match) is caught.
    const hash = insertAuthCode({ expiresAt: 'next tuesday' });
    assert.equal(redeemAuthCode('user@example.com', hash).changes, 0);

    const parsed = db
      .prepare(`SELECT datetime(expires_at) AS parsed FROM auth_codes WHERE code_hash = ?`)
      .get(hash);
    assert.equal(parsed.parsed, null, 'datetime() yields NULL rather than raising');
  });

  it('scopes redemption to the email, so a code cannot be replayed across accounts', () => {
    const hash = insertAuthCode({ email: 'owner@example.com', expiresAt: future() });
    assert.equal(redeemAuthCode('attacker@example.com', hash).changes, 0);
    assert.equal(redeemAuthCode('owner@example.com', hash).changes, 1);
  });

  it('ticks failed_attempts across every live code for an email', () => {
    // A wrong guess has no matching row to tick, so the lockout counter
    // increments every active code for that address instead.
    insertAuthCode({ email: 'user@example.com', expiresAt: future() });
    insertAuthCode({ email: 'user@example.com', expiresAt: future() });
    insertAuthCode({ email: 'user@example.com', expiresAt: past() });
    insertAuthCode({ email: 'other@example.com', expiresAt: future() });

    const touched = db
      .prepare(
        `UPDATE auth_codes SET failed_attempts = failed_attempts + 1
         WHERE email = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')`,
      )
      .run('user@example.com');
    assert.equal(touched.changes, 2, 'expired codes and other addresses are untouched');

    const max = db
      .prepare(
        `SELECT MAX(failed_attempts) AS m FROM auth_codes
         WHERE email = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')`,
      )
      .get('user@example.com').m;
    assert.equal(max, 1);
  });

  it('returns NULL from the MAX lockout probe when no live code remains', () => {
    // The handler compares this against a threshold, so it has to be
    // null (not 0) for the "no codes at all" case to stay distinguishable.
    const m = db
      .prepare(
        `SELECT MAX(failed_attempts) AS m FROM auth_codes
         WHERE email = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')`,
      )
      .get('nobody@example.com').m;
    assert.equal(m, null);
  });

  it('applies the same predicate to agent claim redemption', () => {
    const keyId = insertApiKey();
    const insertClaim = (code, expiresAt) =>
      db
        .prepare(
          `INSERT INTO agent_claims (id, code, api_key_id, sealed_payload, expires_at)
           VALUES (?, ?, ?, 'sealed', ?)`,
        )
        .run(uuidv4(), code, keyId, expiresAt);

    insertClaim('live', future());
    insertClaim('expired', past());

    const redeem = (code) =>
      db
        .prepare(
          `UPDATE agent_claims SET used_at = ?, sealed_payload = ''
           WHERE code = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')`,
        )
        .run(new Date().toISOString(), code).changes;

    assert.equal(redeem('expired'), 0);
    assert.equal(redeem('live'), 1);
    assert.equal(redeem('live'), 0, 'a redeemed claim can never be redeemed again');

    const row = db.prepare(`SELECT sealed_payload FROM agent_claims WHERE code = 'live'`).get();
    assert.equal(row.sealed_payload, '', 'redemption wipes the sealed key in the same statement');
  });

  it('keeps an unredeemed MPP challenge visible to the expiry sweep', () => {
    const live = uuidv4();
    const insertChallenge = (id, expiresAt, redeemedAt = null) =>
      db
        .prepare(
          `INSERT INTO mpp_challenges (id, resource_path, amount_usdc, expires_at, redeemed_at)
           VALUES (?, '/v1/cards/visa/10', '10.00', ?, ?)`,
        )
        .run(id, expiresAt, redeemedAt);

    insertChallenge(live, past());
    insertChallenge(uuidv4(), past(), new Date().toISOString()); // already redeemed
    insertChallenge(uuidv4(), future());

    const sweepable = db
      .prepare(
        `SELECT id FROM mpp_challenges
         WHERE redeemed_at IS NULL AND datetime(expires_at) <= datetime('now')`,
      )
      .all();
    assert.deepEqual(
      sweepable.map((r) => r.id),
      [live],
    );
  });
});

// ── System state ──────────────────────────────────────────────────────────

describe('db.js — system_state upsert semantics', () => {
  beforeEach(() => resetDb());

  it('advances a cursor in place rather than accumulating rows', () => {
    // saveStartLedger runs INSERT OR REPLACE on every watcher tick. If
    // `key` ever stopped being the primary key, this would grow a row
    // per ledger and sysStateInt would start reading an arbitrary one.
    const save = (value) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO system_state (key, value) VALUES ('stellar_start_ledger', ?)`,
        )
        .run(value);

    save('100');
    save('101');
    save('102');

    const rows = db
      .prepare(`SELECT value FROM system_state WHERE key = 'stellar_start_ledger'`)
      .all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, '102');
  });

  it('coerces a bound number to TEXT, which is why every writer passes a string', () => {
    // TEXT affinity stringifies whatever is bound, and better-sqlite3
    // binds a JS number as REAL — so `42` lands as '42.0', not '42'.
    // sysStateInt survives that via parseInt, but a reader comparing
    // === '42' would not, which is why saveStartLedger binds
    // String(ledger) rather than the number.
    db.prepare(`INSERT OR REPLACE INTO system_state (key, value) VALUES ('probe', ?)`).run(42);
    const asNumber = db.prepare(`SELECT value FROM system_state WHERE key = 'probe'`).get();
    assert.equal(typeof asNumber.value, 'string');
    assert.equal(asNumber.value, '42.0');
    assert.equal(parseInt(asNumber.value, 10), 42);

    db.prepare(`INSERT OR REPLACE INTO system_state (key, value) VALUES ('probe', ?)`).run('42');
    const asString = db.prepare(`SELECT value FROM system_state WHERE key = 'probe'`).get();
    assert.equal(asString.value, '42');
  });

  it('returns undefined for a key that was never written', () => {
    // sysStateInt reads `row?.value || '0'`, so the missing-key case has
    // to be undefined rather than a row with a NULL value.
    const row = db.prepare(`SELECT value FROM system_state WHERE key = 'never_set'`).get();
    assert.equal(row, undefined);
  });

  it('reads the freeze flag as the exact string /status compares against', () => {
    db.prepare(`UPDATE system_state SET value = '1' WHERE key = 'frozen'`).run();
    const frozen = db.prepare(`SELECT value FROM system_state WHERE key = 'frozen'`).get();
    assert.equal(frozen.value, '1', 'the comparison is === "1", so a numeric 1 would not match');
  });
});

// ── Silent-failure surfaces ───────────────────────────────────────────────

describe('db.js — stellar_dead_letter table queries', () => {
  beforeEach(() => resetDb());

  function deadLetter(txHash, ledger = 1) {
    db.prepare(
      `INSERT INTO stellar_dead_letter (tx_hash, ledger, raw_event, error)
       VALUES (?, ?, '{}', 'parse failed')`,
    ).run(txHash, ledger);
  }

  it('keys on tx_hash so a replayed ledger cannot double-record an event', () => {
    // The watcher re-reads ledgers on restart. Without the primary key
    // the same unparseable event would inflate the /status counter on
    // every replay and read as an ongoing incident.
    deadLetter('tx-1');
    assert.throws(() => deadLetter('tx-1'), /UNIQUE constraint failed/);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM stellar_dead_letter`).get().n, 1);
  });

  it('counts only the last 24h, the window /status reports on', () => {
    deadLetter('tx-recent');
    deadLetter('tx-old');
    db.prepare(`UPDATE stellar_dead_letter SET created_at = ? WHERE tx_hash = 'tx-old'`).run(
      '2020-01-01T00:00:00.000Z',
    );

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const n = db
      .prepare(`SELECT COUNT(*) AS n FROM stellar_dead_letter WHERE created_at >= ?`)
      .get(since).n;
    assert.equal(n, 1);
  });

  it('requires the raw event and the error, so a row is always actionable', () => {
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO stellar_dead_letter (tx_hash, ledger, raw_event, error)
             VALUES ('tx-2', 1, NULL, 'boom')`,
          )
          .run(),
      /NOT NULL/,
    );
  });
});

describe('db.js — unmatched_payments table queries', () => {
  beforeEach(() => resetDb());

  function unmatched({ id = uuidv4(), reason = 'unknown_order', refundTxid = null } = {}) {
    db.prepare(
      `INSERT INTO unmatched_payments (id, stellar_txid, reason, refund_stellar_txid)
       VALUES (?, ?, ?, ?)`,
    ).run(id, `tx-${id}`, reason, refundTxid);
    return id;
  }

  it('lists the un-refunded backlog through the partial index', () => {
    const pending = unmatched();
    unmatched({ refundTxid: 'refund-tx' });

    const rows = db
      .prepare(
        `SELECT id FROM unmatched_payments WHERE refund_stellar_txid IS NULL ORDER BY created_at`,
      )
      .all();
    assert.deepEqual(
      rows.map((r) => r.id),
      [pending],
    );

    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM unmatched_payments WHERE refund_stellar_txid IS NULL ORDER BY created_at`,
      )
      .all();
    const detail = plan.map((r) => r.detail).join(' ');
    assert.match(detail, /idx_unmatched_payments_pending/, `expected the partial index: ${detail}`);
  });

  it('records the reason a payment could not be matched', () => {
    // reason is NOT NULL because a row without one cannot be triaged —
    // the operator has no way to tell a wrong-asset payment from a
    // post-expiry one.
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO unmatched_payments (id, stellar_txid, reason) VALUES (?, 'tx-x', NULL)`,
          )
          .run(uuidv4()),
      /NOT NULL/,
    );
  });

  it('allows several unmatched payments to claim the same order id', () => {
    // claimed_order_id is deliberately unconstrained: two senders can
    // both quote the same memo, and both rows have to survive for the
    // operator to see the collision.
    const a = unmatched();
    const b = unmatched();
    db.prepare(`UPDATE unmatched_payments SET claimed_order_id = 'order-1' WHERE id IN (?, ?)`).run(
      a,
      b,
    );
    assert.equal(
      db
        .prepare(`SELECT COUNT(*) AS n FROM unmatched_payments WHERE claimed_order_id = 'order-1'`)
        .get().n,
      2,
    );
  });
});

describe('db.js — policy_decisions table queries', () => {
  beforeEach(() => resetDb());

  function decide(apiKeyId, { decision = 'approved', rule = 'under_limit', amount = '5.00' } = {}) {
    const id = uuidv4();
    db.prepare(
      `INSERT INTO policy_decisions (id, api_key_id, decision, rule, reason, amount_usdc)
       VALUES (?, ?, ?, ?, 'test', ?)`,
    ).run(id, apiKeyId, decision, rule, amount);
    return id;
  }

  it('scopes the decision history to one api key', () => {
    const mine = insertApiKey();
    const theirs = insertApiKey();
    decide(mine);
    decide(mine, { decision: 'blocked', rule: 'daily_limit_exceeded' });
    decide(theirs);

    const rows = db
      .prepare(
        `SELECT decision FROM policy_decisions WHERE api_key_id = ? ORDER BY created_at DESC`,
      )
      .all(mine);
    assert.equal(rows.length, 2);
  });

  it('plans the per-key history query through its composite index', () => {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT * FROM policy_decisions WHERE api_key_id = ? ORDER BY created_at DESC`,
      )
      .all('some-key');
    const detail = plan.map((r) => r.detail).join(' ');
    assert.match(detail, /idx_policy_decisions_api_key/, `expected an index scan: ${detail}`);
  });

  it('records a blocked decision with no order_id', () => {
    // A block happens before the order row exists, so order_id has to
    // stay nullable — making it NOT NULL would drop exactly the
    // decisions an operator most wants to audit.
    const keyId = insertApiKey();
    const id = decide(keyId, { decision: 'blocked', rule: 'daily_limit_exceeded' });
    const row = db.prepare(`SELECT * FROM policy_decisions WHERE id = ?`).get(id);
    assert.equal(row.order_id, null);
    assert.equal(row.decision, 'blocked');
    assert.ok(row.created_at);
  });

  it('requires a decision and a rule on every row', () => {
    const keyId = insertApiKey();
    for (const [decision, rule] of [
      [null, 'some_rule'],
      ['approved', null],
    ]) {
      assert.throws(
        () =>
          db
            .prepare(
              `INSERT INTO policy_decisions (id, api_key_id, decision, rule, reason)
               VALUES (?, ?, ?, ?, 'test')`,
            )
            .run(uuidv4(), keyId, decision, rule),
        /NOT NULL/,
      );
    }
  });
});

// ── agent_claims ──────────────────────────────────────────────────────────
//
// The one-shot claim redemption is the most security-sensitive statement
// pair in the codebase: it is how a dashboard-minted code becomes a live
// api key, it is reachable without any credential, and it has to be
// exactly-once under concurrency. api/agent-claim.js relies on three
// distinct database-level properties to get that, and none of them was
// covered here:
//
//   1. The lookup filters on `used_at IS NULL` AND an unexpired
//      `expires_at`, compared through datetime() rather than lexically.
//   2. The mark-used UPDATE is a compare-and-swap — it re-states
//      `used_at IS NULL` in its WHERE clause, so the loser of a race sees
//      changes === 0 rather than redeeming the same code twice.
//   3. The decrypt happens INSIDE the transaction, so a throw rolls the
//      mark-used back and the claim stays redeemable. Without that, a
//      transient server misconfiguration permanently burns a claim.
//
// Each test below is one of those, phrased as the SQL the route runs.

describe('db.js — agent_claims table queries', () => {
  beforeEach(() => resetDb());

  const FUTURE = "datetime('now', '+10 minutes')";
  const PAST = "datetime('now', '-10 minutes')";

  /** Insert a claim row, defaulting to unused and unexpired. */
  function insertClaim({
    id = uuidv4(),
    code = `hash-${uuidv4()}`,
    apiKeyId = uuidv4(),
    payload = 'sealed-blob',
    expiresAt = FUTURE,
    usedAt = null,
  } = {}) {
    db.prepare(
      `INSERT INTO agent_claims (id, code, api_key_id, sealed_payload, expires_at, used_at)
       VALUES (?, ?, ?, ?, ${expiresAt}, ?)`,
    ).run(id, code, apiKeyId, payload, usedAt);
    return { id, code, apiKeyId };
  }

  /** The exact lookup api/agent-claim.js runs, by code hash. */
  function lookup(code) {
    return db
      .prepare(
        `SELECT api_key_id, sealed_payload FROM agent_claims
         WHERE code = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')`,
      )
      .get(code);
  }

  /** The exact mark-used compare-and-swap the route runs. */
  function markUsed(code, { ip = '203.0.113.7' } = {}) {
    return db
      .prepare(
        `UPDATE agent_claims
         SET used_at = @now, claimed_ip = @ip, sealed_payload = ''
         WHERE code = @code AND used_at IS NULL`,
      )
      .run({ code, now: new Date().toISOString(), ip });
  }

  it('inserts and retrieves a claim by code', () => {
    const { code, apiKeyId } = insertClaim();
    const row = /** @type {any} */ (lookup(code));
    assert.equal(row.api_key_id, apiKeyId);
    assert.equal(row.sealed_payload, 'sealed-blob');
  });

  it('defaults created_at and leaves used_at and claimed_ip null', () => {
    const { code } = insertClaim();
    const row = /** @type {any} */ (
      db
        .prepare(`SELECT created_at, used_at, claimed_ip FROM agent_claims WHERE code = ?`)
        .get(code)
    );
    assert.ok(row.created_at, 'created_at should default');
    assert.equal(row.used_at, null);
    assert.equal(row.claimed_ip, null);
  });

  it('the lookup misses a claim that has already been used', () => {
    const { code } = insertClaim({ usedAt: new Date().toISOString() });
    assert.equal(lookup(code), undefined);
  });

  it('the lookup misses an expired claim', () => {
    const { code } = insertClaim({ expiresAt: PAST });
    assert.equal(lookup(code), undefined);
  });

  it('compares expiry through datetime(), not lexically', () => {
    // The column holds whatever the mint path wrote. dashboard.js writes
    // an ISO-8601 string with a T separator and a Z suffix, while the
    // SQL default elsewhere in this schema is datetime('now') — space
    // separator, no zone. A lexical `expires_at > 'now'` comparison
    // gets those two forms wrong in opposite directions; datetime()
    // normalises both. A live claim in ISO form must be found.
    const code = `hash-${uuidv4()}`;
    db.prepare(
      `INSERT INTO agent_claims (id, code, api_key_id, sealed_payload, expires_at)
       VALUES (?, ?, ?, 'blob', ?)`,
    ).run(uuidv4(), code, uuidv4(), new Date(Date.now() + 600_000).toISOString());
    assert.ok(lookup(code), 'an ISO-8601 expires_at in the future must match');
  });

  it('marks a claim used exactly once — the second attempt changes nothing', () => {
    // The compare-and-swap that makes redemption exactly-once. Two
    // concurrent callers both pass the lookup; better-sqlite3 serialises
    // the writes, and the loser has to see changes === 0.
    const { code } = insertClaim();
    assert.equal(markUsed(code).changes, 1, 'the first redemption wins');
    assert.equal(markUsed(code).changes, 0, 'the second must be a no-op');
  });

  it('wipes sealed_payload and records the claiming IP in the same statement', () => {
    // The wipe and the mark-used are one UPDATE on purpose: a crash
    // between two separate statements would leave a redeemed claim whose
    // sealed_payload is still extractable from a DB dump.
    const { code } = insertClaim();
    markUsed(code, { ip: '198.51.100.4' });
    const row = /** @type {any} */ (
      db
        .prepare(`SELECT used_at, claimed_ip, sealed_payload FROM agent_claims WHERE code = ?`)
        .get(code)
    );
    assert.ok(row.used_at, 'used_at should be stamped');
    assert.equal(row.claimed_ip, '198.51.100.4');
    assert.equal(row.sealed_payload, '', 'the sealed payload must be wiped');
  });

  it('leaves the claim redeemable when the enclosing transaction throws', () => {
    // api/agent-claim.js decrypts INSIDE the transaction specifically so
    // a decrypt failure — a missing key, a corrupt blob, a rotated key —
    // rolls the mark-used back instead of burning the claim. If the
    // rollback did not cover the UPDATE, a transient misconfiguration
    // would permanently destroy a customer's onboarding code.
    const { code } = insertClaim();
    const redeem = db.transaction((c) => {
      markUsed(c);
      throw new Error('decrypt failed');
    });
    assert.throws(() => redeem(code), /decrypt failed/);

    const row = /** @type {any} */ (lookup(code));
    assert.ok(row, 'the claim must still be redeemable after a rollback');
    assert.equal(row.sealed_payload, 'sealed-blob', 'the payload wipe must roll back too');
  });

  it('prunes used and long-expired claims, keeping fresh ones', () => {
    // Drives the real pruneExpiredAgentClaims from jobs.js rather than a
    // copy of its DELETE, so a dropped predicate in the shipped statement
    // fails here. Four rows, one per branch of its WHERE clause.
    const { pruneExpiredAgentClaims } = require('../../src/jobs');

    const staleUsed = insertClaim({
      usedAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
    });
    const staleExpired = insertClaim({ expiresAt: "datetime('now', '-48 hours')" });
    const recentlyUsed = insertClaim({ usedAt: new Date().toISOString() });
    const live = insertClaim();

    pruneExpiredAgentClaims();

    const remaining = new Set(
      /** @type {any[]} */ (db.prepare(`SELECT id FROM agent_claims`).all()).map((r) => r.id),
    );
    assert.equal(remaining.size, 2);
    assert.ok(!remaining.has(staleUsed.id), 'a claim used 48h ago should be pruned');
    assert.ok(!remaining.has(staleExpired.id), 'a claim expired 48h ago should be pruned');
    assert.ok(remaining.has(recentlyUsed.id), 'a just-redeemed claim is still audit-relevant');
    assert.ok(remaining.has(live.id), 'a live unused claim must survive');
  });

  it('plans the code lookup through an index, not a table scan', () => {
    // The claim endpoint is unauthenticated and rate-limited per IP. A
    // table scan here is a scan an anonymous caller controls the rate of.
    //
    // Deliberately not asserting on idx_agent_claims_code by name:
    // `code TEXT NOT NULL UNIQUE` gives SQLite an implicit index for this
    // lookup anyway, so naming the explicit one would assert something
    // the query does not actually depend on. What must hold is that no
    // plan for this statement is a scan.
    const plan = /** @type {any[]} */ (
      db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT api_key_id, sealed_payload FROM agent_claims
           WHERE code = ? AND used_at IS NULL`,
        )
        .all('some-hash')
    );
    const detail = plan.map((r) => r.detail).join(' | ');
    assert.match(detail, /USING (COVERING )?INDEX/, detail);
  });
});

// ── approval_requests ─────────────────────────────────────────────────────

describe('db.js — approval_requests table queries', () => {
  beforeEach(() => resetDb());

  function insertApproval({
    id = uuidv4(),
    apiKeyId = uuidv4(),
    orderId = uuidv4(),
    amount = '250.00',
    status = null,
    expiresAt = "datetime('now', '+2 hours')",
  } = {}) {
    db.prepare(
      `INSERT INTO approval_requests (id, api_key_id, order_id, amount_usdc, status, expires_at)
       VALUES (?, ?, ?, ?, COALESCE(?, 'pending'), ${expiresAt})`,
    ).run(id, apiKeyId, orderId, amount, status);
    return id;
  }

  it('defaults status to pending and stamps requested_at', () => {
    const id = uuidv4();
    db.prepare(
      `INSERT INTO approval_requests (id, api_key_id, order_id, amount_usdc, expires_at)
       VALUES (?, ?, ?, '10.00', datetime('now', '+2 hours'))`,
    ).run(id, uuidv4(), uuidv4());
    const row = /** @type {any} */ (
      db
        .prepare(`SELECT status, requested_at, decided_at FROM approval_requests WHERE id = ?`)
        .get(id)
    );
    assert.equal(row.status, 'pending');
    assert.ok(row.requested_at, 'requested_at should default');
    assert.equal(row.decided_at, null);
  });

  it('stores amount_usdc as TEXT without numeric coercion', () => {
    // Same reasoning as the orders column: a REAL round-trip loses cents.
    const id = insertApproval({ amount: '1234.50' });
    const row = /** @type {any} */ (
      db.prepare(`SELECT amount_usdc FROM approval_requests WHERE id = ?`).get(id)
    );
    assert.equal(typeof row.amount_usdc, 'string');
    assert.equal(row.amount_usdc, '1234.50');
  });

  it('the expiry sweep selects only pending requests past their window', () => {
    // The SELECT from expireApprovalRequests. One row per branch it has
    // to exclude, so a dropped predicate shows up as a wrong count.
    const overdue = insertApproval({ expiresAt: "datetime('now', '-1 minute')" });
    insertApproval({ expiresAt: "datetime('now', '+2 hours')" });
    insertApproval({ status: 'approved', expiresAt: "datetime('now', '-1 minute')" });
    insertApproval({ status: 'rejected', expiresAt: "datetime('now', '-1 minute')" });

    const rows = /** @type {any[]} */ (
      db
        .prepare(
          `SELECT * FROM approval_requests
           WHERE status = 'pending' AND datetime(expires_at) < datetime('now')`,
        )
        .all()
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, overdue);
  });

  it('expires a pending request exactly once via compare-and-swap', () => {
    const id = insertApproval({ expiresAt: "datetime('now', '-1 minute')" });
    const expire = () =>
      db
        .prepare(
          `UPDATE approval_requests SET status = 'expired', decided_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(new Date().toISOString(), id);
    assert.equal(expire().changes, 1);
    assert.equal(expire().changes, 0, 'a second sweep must not re-decide it');
  });

  it('the sweep expires the stale request and leaves a decided one alone', () => {
    // Driven through the real expireApprovalRequests so a dropped
    // predicate in the shipped SELECT fails here.
    //
    // Note what this does and does not cover. It pins the sweep's own
    // filter — an approved request is never picked up, even once it is
    // past its window. It does NOT cover the compare-and-swap in the
    // UPDATE, because that only fires when an operator decides in the
    // gap between the SELECT and the UPDATE, and a test cannot open that
    // gap from outside the function. The statement's exactly-once
    // semantics are pinned directly by the test above instead; removing
    // `AND status = 'pending'` from the job leaves this test green.
    const { expireApprovalRequests } = require('../../src/jobs');

    const overdue = insertApproval({ expiresAt: "datetime('now', '-1 minute')" });
    const decided = insertApproval({ expiresAt: "datetime('now', '-1 minute')" });
    db.prepare(`UPDATE approval_requests SET status = 'approved' WHERE id = ?`).run(decided);

    expireApprovalRequests();

    const statuses = Object.fromEntries(
      /** @type {any[]} */ (db.prepare(`SELECT id, status FROM approval_requests`).all()).map(
        (r) => [r.id, r.status],
      ),
    );
    assert.equal(statuses[overdue], 'expired', 'a genuinely stale request is expired');
    assert.equal(statuses[decided], 'approved', "the operator's decision must survive");
  });

  it('finds the pending approvals for a suspended agent', () => {
    // The cascade POST /dashboard/api-keys/:id/suspend runs: every
    // pending approval for that key gets rejected along with its order.
    const apiKeyId = uuidv4();
    insertApproval({ apiKeyId });
    insertApproval({ apiKeyId });
    insertApproval({ apiKeyId, status: 'approved' });
    insertApproval({ apiKeyId: uuidv4() });

    const rows = /** @type {any[]} */ (
      db
        .prepare(`SELECT * FROM approval_requests WHERE api_key_id = ? AND status = 'pending'`)
        .all(apiKeyId)
    );
    assert.equal(rows.length, 2);
  });

  it('looks an approval up by the order it gates', () => {
    const orderId = uuidv4();
    const id = insertApproval({ orderId });
    const row = /** @type {any} */ (
      db
        .prepare(`SELECT id, expires_at, status FROM approval_requests WHERE order_id = ?`)
        .get(orderId)
    );
    assert.equal(row.id, id);
    assert.equal(row.status, 'pending');
  });

  it('plans the pending sweep through the status index', () => {
    const plan = /** @type {any[]} */ (
      db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT * FROM approval_requests WHERE status = 'pending'`,
        )
        .all()
    );
    const detail = plan.map((r) => r.detail).join(' | ');
    assert.match(detail, /USING (COVERING )?INDEX idx_approval_requests_status/, detail);
  });
});

// ── alert_rules and alert_firings ─────────────────────────────────────────

describe('db.js — alert_rules table queries', () => {
  beforeEach(() => resetDb());

  function insertRule({
    id = uuidv4(),
    dashboardId = uuidv4(),
    name = 'failures high',
    kind = 'failure_rate_high',
  } = {}) {
    db.prepare(`INSERT INTO alert_rules (id, dashboard_id, name, kind) VALUES (?, ?, ?, ?)`).run(
      id,
      dashboardId,
      name,
      kind,
    );
    return id;
  }

  it('defaults config to an empty JSON object, enabled to 1, snooze to null', () => {
    // lib/alerts.js JSON.parses `config` on every read. A NULL default
    // would make every listRules call fall into its safeParse fallback,
    // which is indistinguishable from a rule whose config was cleared.
    const id = insertRule();
    const row = /** @type {any} */ (
      db
        .prepare(
          `SELECT config, enabled, snoozed_until, created_at, updated_at
                  FROM alert_rules WHERE id = ?`,
        )
        .get(id)
    );
    assert.equal(row.config, '{}');
    assert.deepEqual(JSON.parse(row.config), {});
    assert.equal(row.enabled, 1);
    assert.equal(row.snoozed_until, null);
    assert.ok(row.created_at);
    assert.ok(row.updated_at);
  });

  it('rejects a rule with no name or no kind', () => {
    for (const [name, kind] of [
      [null, 'failure_rate_high'],
      ['unnamed', null],
    ]) {
      assert.throws(
        () =>
          db
            .prepare(`INSERT INTO alert_rules (id, dashboard_id, name, kind) VALUES (?, ?, ?, ?)`)
            .run(uuidv4(), uuidv4(), name, kind),
        /NOT NULL/,
      );
    }
  });

  it('lists only the enabled rules for one dashboard', () => {
    const dashboardId = uuidv4();
    const enabled = insertRule({ dashboardId });
    const disabled = insertRule({ dashboardId });
    db.prepare(`UPDATE alert_rules SET enabled = 0 WHERE id = ?`).run(disabled);
    insertRule({ dashboardId: uuidv4() });

    const rows = /** @type {any[]} */ (
      db
        .prepare(`SELECT id FROM alert_rules WHERE dashboard_id = ? AND enabled = 1`)
        .all(dashboardId)
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [enabled],
    );
  });

  it('plans the per-dashboard rule lookup through an index', () => {
    const plan = /** @type {any[]} */ (
      db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id FROM alert_rules WHERE dashboard_id = ? AND enabled = 1`,
        )
        .all('some-dashboard')
    );
    const detail = plan.map((r) => r.detail).join(' | ');
    assert.match(detail, /USING (COVERING )?INDEX idx_alert_rules_dashboard/, detail);
  });
});

describe('db.js — alert_firings table queries', () => {
  beforeEach(() => resetDb());

  /**
   * `firedAt` is a SQL expression, not a bound value — it has to be
   * interpolated so `datetime('now', '-30 minutes')` is evaluated by
   * SQLite rather than stored as that literal text. Binding it instead
   * stores the string, `datetime()` of which is NULL, and every window
   * comparison then quietly returns false — which reads as "the cooldown
   * works" no matter what the query does. Tests only; nothing here is
   * caller-supplied.
   */
  function insertFiring({
    ruleId = uuidv4(),
    dashboardId = uuidv4(),
    firedAt = "datetime('now')",
    context = null,
  } = {}) {
    const info = db
      .prepare(
        `INSERT INTO alert_firings (rule_id, dashboard_id, fired_at, context)
         VALUES (?, ?, ${firedAt}, ?)`,
      )
      .run(ruleId, dashboardId, context);
    return Number(info.lastInsertRowid);
  }

  it('assigns an autoincrementing id and defaults notified to 0', () => {
    const first = insertFiring();
    const second = insertFiring();
    assert.ok(second > first, 'ids must increase');
    const row = /** @type {any} */ (
      db.prepare(`SELECT notified, fired_at FROM alert_firings WHERE id = ?`).get(first)
    );
    assert.equal(row.notified, 0);
    assert.ok(row.fired_at);
  });

  it('the cooldown probe sees a firing inside the window and not one outside it', () => {
    // The statement that stops a persistent failure mode from spamming
    // Discord every tick. Default cooldown is 15 minutes.
    const ruleId = uuidv4();
    const probe = () =>
      db
        .prepare(
          `SELECT 1 AS ok FROM alert_firings
           WHERE rule_id = ? AND datetime(fired_at) > datetime('now', ?)
           LIMIT 1`,
        )
        .get(ruleId, '-15 minutes');

    assert.equal(probe(), undefined, 'a rule that never fired has no cooldown');

    insertFiring({ ruleId, firedAt: "datetime('now', '-30 minutes')" });
    assert.equal(probe(), undefined, 'a firing older than the window must not suppress');

    insertFiring({ ruleId, firedAt: "datetime('now', '-1 minute')" });
    assert.ok(probe(), 'a firing inside the window must suppress');
  });

  it('scopes the cooldown probe to one rule', () => {
    // Keyed on rule_id, not dashboard_id: one noisy rule must not
    // silence every other alert the dashboard has configured.
    const quiet = uuidv4();
    insertFiring({ ruleId: uuidv4(), firedAt: "datetime('now', '-1 minute')" });
    const row = db
      .prepare(
        `SELECT 1 AS ok FROM alert_firings
         WHERE rule_id = ? AND datetime(fired_at) > datetime('now', ?) LIMIT 1`,
      )
      .get(quiet, '-15 minutes');
    assert.equal(row, undefined);
  });

  it('orders history by id, which survives a same-second fired_at tie', () => {
    // datetime('now') has one-second resolution, so several firings in
    // one tick share a fired_at. listFirings orders by f.id DESC rather
    // than f.fired_at for exactly that reason — ordering by the timestamp
    // would return them in an arbitrary order and the operator would see
    // history shuffle between page loads.
    const dashboardId = uuidv4();
    const at = '2026-07-30 12:00:00';
    const ids = [
      insertFiring({ dashboardId, firedAt: `'${at}'` }),
      insertFiring({ dashboardId, firedAt: `'${at}'` }),
      insertFiring({ dashboardId, firedAt: `'${at}'` }),
    ];
    const rows = /** @type {any[]} */ (
      db
        .prepare(`SELECT id, fired_at FROM alert_firings WHERE dashboard_id = ? ORDER BY id DESC`)
        .all(dashboardId)
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      [...ids].reverse(),
    );
    assert.equal(new Set(rows.map((r) => r.fired_at)).size, 1, 'all three share one timestamp');
  });

  it('keeps a firing whose rule has been deleted, with a null rule name', () => {
    // rule_id carries no FOREIGN KEY, so history outlives the rule that
    // produced it — which is the point: deleting a rule must not erase
    // the record of what it fired on. listFirings LEFT JOINs for the
    // name, so the row survives with rule_name null. An INNER JOIN would
    // silently drop it and the operator's history would develop holes.
    const dashboardId = uuidv4();
    const ruleId = uuidv4();
    db.prepare(`INSERT INTO alert_rules (id, dashboard_id, name, kind) VALUES (?, ?, ?, ?)`).run(
      ruleId,
      dashboardId,
      'doomed rule',
      'failure_rate_high',
    );
    insertFiring({ ruleId, dashboardId });
    db.prepare(`DELETE FROM alert_rules WHERE id = ?`).run(ruleId);

    const rows = /** @type {any[]} */ (
      db
        .prepare(
          `SELECT f.id, r.name AS rule_name
           FROM alert_firings f LEFT JOIN alert_rules r ON r.id = f.rule_id
           WHERE f.dashboard_id = ? ORDER BY f.id DESC`,
        )
        .all(dashboardId)
    );
    assert.equal(rows.length, 1, 'the firing must survive its rule');
    assert.equal(rows[0].rule_name, null);
  });

  it('plans the cooldown probe through the rule index', () => {
    const plan = /** @type {any[]} */ (
      db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT 1 FROM alert_firings WHERE rule_id = ? AND fired_at > ? LIMIT 1`,
        )
        .all('some-rule', 'some-time')
    );
    const detail = plan.map((r) => r.detail).join(' | ');
    assert.match(detail, /USING (COVERING )?INDEX idx_alert_firings_rule/, detail);
  });
});

// ── dashboards ────────────────────────────────────────────────────────────

describe('db.js — dashboards table queries', () => {
  beforeEach(() => resetDb());

  function insertUser({ id = uuidv4(), email = `owner-${uuidv4()}@stellar_card.test` } = {}) {
    db.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run(id, email);
    return id;
  }

  it('defaults name, frozen and created_at', () => {
    const userId = insertUser();
    const id = uuidv4();
    db.prepare(`INSERT INTO dashboards (id, user_id) VALUES (?, ?)`).run(id, userId);
    const row = /** @type {any} */ (
      db
        .prepare(`SELECT name, frozen, spend_limit_usdc, created_at FROM dashboards WHERE id = ?`)
        .get(id)
    );
    assert.equal(row.name, 'My Dashboard');
    assert.equal(row.frozen, 0);
    assert.equal(row.spend_limit_usdc, null);
    assert.ok(row.created_at);
  });

  it('rejects a dashboard with no owning user', () => {
    assert.throws(
      () => db.prepare(`INSERT INTO dashboards (id, user_id) VALUES (?, NULL)`).run(uuidv4()),
      /NOT NULL/,
    );
  });

  it('lets one user own several dashboards', () => {
    const userId = insertUser();
    db.prepare(`INSERT INTO dashboards (id, user_id, name) VALUES (?, ?, ?)`).run(
      uuidv4(),
      userId,
      'Primary',
    );
    db.prepare(`INSERT INTO dashboards (id, user_id, name) VALUES (?, ?, ?)`).run(
      uuidv4(),
      userId,
      'Secondary',
    );
    const rows = /** @type {any[]} */ (
      db.prepare(`SELECT name FROM dashboards WHERE user_id = ? ORDER BY name`).all(userId)
    );
    assert.deepEqual(
      rows.map((r) => r.name),
      ['Primary', 'Secondary'],
    );
  });

  it('refuses to delete a dashboard that still owns api keys', () => {
    // `api_keys.dashboard_id TEXT REFERENCES dashboards(id)` — declared
    // in migration 8 with NO cascade, so the constraint restricts rather
    // than deletes. That is the right way round: a cascade would silently
    // destroy live agent credentials, while the restriction forces the
    // caller to decide what happens to the keys. It only holds because
    // `foreign_keys = ON` is set at boot; without that pragma SQLite
    // ignores the reference entirely and the delete would orphan every
    // key into a tenant that no longer exists.
    const userId = insertUser();
    const dashboardId = uuidv4();
    db.prepare(`INSERT INTO dashboards (id, user_id) VALUES (?, ?)`).run(dashboardId, userId);
    db.prepare(`INSERT INTO api_keys (id, key_hash, dashboard_id) VALUES (?, ?, ?)`).run(
      uuidv4(),
      `hash-${uuidv4()}`,
      dashboardId,
    );
    assert.throws(
      () => db.prepare(`DELETE FROM dashboards WHERE id = ?`).run(dashboardId),
      /FOREIGN KEY/,
    );
    const still = /** @type {any} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM dashboards WHERE id = ?`).get(dashboardId)
    );
    assert.equal(still.n, 1, 'the dashboard and its keys are both intact');
  });

  it('cascades the dashboard away when the owning user is deleted', () => {
    // The user cascade DOES fire — dashboards.user_id declares
    // ON DELETE CASCADE — and it reaches api_keys through the same
    // restriction as above only because api_keys is emptied first by the
    // key cascade. Pinned because the two directions behave differently
    // and reading the schema alone does not make that obvious.
    const userId = insertUser();
    const dashboardId = uuidv4();
    db.prepare(`INSERT INTO dashboards (id, user_id) VALUES (?, ?)`).run(dashboardId, userId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    const row = /** @type {any} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM dashboards WHERE id = ?`).get(dashboardId)
    );
    assert.equal(row.n, 0);
  });

  it('plans the per-user dashboard lookup through an index', () => {
    const plan = /** @type {any[]} */ (
      db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM dashboards WHERE user_id = ?`).all('some-user')
    );
    const detail = plan.map((r) => r.detail).join(' | ');
    assert.match(detail, /USING (COVERING )?INDEX idx_dashboards_user_id/, detail);
  });
});

// ── admin_actions ─────────────────────────────────────────────────────────

describe('db.js — admin_actions table queries', () => {
  beforeEach(() => resetDb());

  function insertAction({
    id = uuidv4(),
    actor = 'ops@stellar_card.test',
    action = 'refund_order',
    targetType = 'order',
    targetId = uuidv4(),
    metadata = null,
    createdAt = null,
  } = {}) {
    db.prepare(
      `INSERT INTO admin_actions
         (id, actor_email, action, target_type, target_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    ).run(id, actor, action, targetType, targetId, metadata, createdAt);
    return id;
  }

  it('inserts and retrieves an action', () => {
    const id = insertAction();
    const row = /** @type {any} */ (db.prepare(`SELECT * FROM admin_actions WHERE id = ?`).get(id));
    assert.equal(row.actor_email, 'ops@stellar_card.test');
    assert.equal(row.action, 'refund_order');
    assert.equal(row.target_type, 'order');
    assert.ok(row.created_at);
  });

  it('allows a null target_id for system-wide actions', () => {
    // target_type 'system' has nothing to point at — an unfreeze is not
    // scoped to one order or one key.
    const id = insertAction({ action: 'unfreeze', targetType: 'system', targetId: null });
    const row = /** @type {any} */ (
      db.prepare(`SELECT target_id FROM admin_actions WHERE id = ?`).get(id)
    );
    assert.equal(row.target_id, null);
  });

  it('round-trips the JSON metadata blob without alteration', () => {
    const metadata = JSON.stringify({ reason: 'duplicate charge', amount_usdc: '10.00' });
    const id = insertAction({ metadata });
    const row = /** @type {any} */ (
      db.prepare(`SELECT metadata FROM admin_actions WHERE id = ?`).get(id)
    );
    assert.equal(row.metadata, metadata);
    assert.deepEqual(JSON.parse(row.metadata), {
      reason: 'duplicate charge',
      amount_usdc: '10.00',
    });
  });

  it('rejects an action with no actor', () => {
    // The whole value of this table is answering "who did this". A row
    // with a null actor_email is worse than no row: it looks like an
    // audit trail and is not one.
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO admin_actions (id, actor_email, action, target_type)
             VALUES (?, NULL, 'refund_order', 'order')`,
          )
          .run(uuidv4()),
      /NOT NULL/,
    );
  });

  it('reads one actor history in reverse chronological order', () => {
    const actor = 'auditor@stellar_card.test';
    insertAction({ actor, action: 'first', createdAt: '2026-07-01 10:00:00' });
    insertAction({ actor, action: 'second', createdAt: '2026-07-02 10:00:00' });
    insertAction({ actor: 'someone-else@stellar_card.test', action: 'third' });

    const rows = /** @type {any[]} */ (
      db
        .prepare(`SELECT action FROM admin_actions WHERE actor_email = ? ORDER BY created_at DESC`)
        .all(actor)
    );
    assert.deepEqual(
      rows.map((r) => r.action),
      ['second', 'first'],
    );
  });

  it('plans the actor history through an index', () => {
    const plan = /** @type {any[]} */ (
      db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT action FROM admin_actions WHERE actor_email = ? ORDER BY created_at DESC`,
        )
        .all('someone@example.com')
    );
    const detail = plan.map((r) => r.detail).join(' | ');
    assert.match(detail, /USING (COVERING )?INDEX idx_admin_actions_actor/, detail);
  });
});

// ── mpp_challenges ────────────────────────────────────────────────────────

describe('db.js — mpp_challenges table queries', () => {
  beforeEach(() => resetDb());

  function insertChallenge({
    id = uuidv4(),
    resourcePath = '/v1/cards/visa/10.00',
    amount = '10.00',
    expiresAt = new Date(Date.now() + 600_000).toISOString(),
  } = {}) {
    db.prepare(
      `INSERT INTO mpp_challenges (id, resource_path, amount_usdc, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).run(id, resourcePath, amount, expiresAt);
    return id;
  }

  it('inserts with created_at defaulted and redemption columns null', () => {
    const id = insertChallenge();
    const row = /** @type {any} */ (
      db
        .prepare(
          `SELECT created_at, redeemed_at, redeemed_tx_hash, order_id, client_ip
           FROM mpp_challenges WHERE id = ?`,
        )
        .get(id)
    );
    assert.ok(row.created_at);
    assert.equal(row.redeemed_at, null);
    assert.equal(row.redeemed_tx_hash, null);
    assert.equal(row.order_id, null);
    assert.equal(row.client_ip, null);
  });

  it('redeems a challenge exactly once via compare-and-swap', () => {
    const id = insertChallenge();
    const redeem = (txHash) =>
      db
        .prepare(
          `UPDATE mpp_challenges
             SET redeemed_at = @now, redeemed_tx_hash = @tx_hash, order_id = @order_id
           WHERE id = @id AND redeemed_at IS NULL`,
        )
        .run({ id, now: new Date().toISOString(), tx_hash: txHash, order_id: null });

    assert.equal(redeem('tx-aaa').changes, 1);
    assert.equal(redeem('tx-bbb').changes, 0, 'a redeemed challenge must not be re-bound');

    const row = /** @type {any} */ (
      db.prepare(`SELECT redeemed_tx_hash FROM mpp_challenges WHERE id = ?`).get(id)
    );
    assert.equal(row.redeemed_tx_hash, 'tx-aaa', 'the first tx keeps the challenge');
  });

  it('rejects a challenge bound to an order that does not exist', () => {
    // order_id carries a real FOREIGN KEY. A challenge pointing at a
    // missing order would make the receipt endpoint 404 on a payment
    // that actually settled.
    const id = insertChallenge();
    assert.throws(
      () => db.prepare(`UPDATE mpp_challenges SET order_id = ? WHERE id = ?`).run(uuidv4(), id),
      /FOREIGN KEY/,
    );
  });

  it('binds a challenge to a real order', () => {
    const orderId = insertOrder();
    const id = insertChallenge();
    db.prepare(`UPDATE mpp_challenges SET order_id = ? WHERE id = ?`).run(orderId, id);
    const row = /** @type {any} */ (
      db.prepare(`SELECT order_id FROM mpp_challenges WHERE id = ?`).get(id)
    );
    assert.equal(row.order_id, orderId);
  });

  it('prunes unredeemed expired challenges and keeps redeemed ones', () => {
    // The DELETE from mpp/challenge.js. `redeemed_at IS NULL` is
    // load-bearing: a redeemed challenge is the receipt for a settled
    // payment and has to survive its own expiry.
    const now = new Date().toISOString();
    const staleUnredeemed = insertChallenge({
      expiresAt: new Date(Date.now() - 600_000).toISOString(),
    });
    const live = insertChallenge();
    const staleRedeemed = insertChallenge({
      expiresAt: new Date(Date.now() - 600_000).toISOString(),
    });
    db.prepare(`UPDATE mpp_challenges SET redeemed_at = ?, redeemed_tx_hash = ? WHERE id = ?`).run(
      now,
      'tx-settled',
      staleRedeemed,
    );

    const result = db
      .prepare(`DELETE FROM mpp_challenges WHERE redeemed_at IS NULL AND expires_at < ?`)
      .run(now);
    assert.equal(result.changes, 1);

    const remaining = new Set(
      /** @type {any[]} */ (db.prepare(`SELECT id FROM mpp_challenges`).all()).map((r) => r.id),
    );
    assert.ok(!remaining.has(staleUnredeemed));
    assert.ok(remaining.has(live), 'an unexpired challenge must survive');
    assert.ok(remaining.has(staleRedeemed), 'a settled payment receipt must survive its expiry');
  });

  it('plans the expiry sweep through the partial index', () => {
    // The index is partial (WHERE redeemed_at IS NULL) so it stays small
    // as redeemed history accumulates. That only pays off if the sweep's
    // own predicate lets SQLite use it.
    const plan = /** @type {any[]} */ (
      db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id FROM mpp_challenges WHERE redeemed_at IS NULL AND expires_at < ?`,
        )
        .all('2026-01-01T00:00:00.000Z')
    );
    const detail = plan.map((r) => r.detail).join(' | ');
    assert.match(detail, /USING (COVERING )?INDEX idx_mpp_challenges_expires/, detail);
  });
});
