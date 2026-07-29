// Unit tests for db.js schema initialization and core query behaviour.
// Exercises table existence, seed data, constraint enforcement, and
// basic CRUD round-trips — all against the in-memory SQLite instance
// spun up by the test helper.

require('../helpers/env');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');
const { db, resetDb } = require('../helpers/app');

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
  it('WAL journal mode is active', () => {
    const row = db.prepare(`PRAGMA journal_mode`).get();
    assert.equal(row.journal_mode, 'wal');
  });

  it('foreign keys pragma is ON', () => {
    const row = db.prepare(`PRAGMA foreign_keys`).get();
    assert.equal(row.foreign_keys, 1);
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
