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
