// Unit tests for issue #953 — stale unconfirmed transaction timeout/sweep worker.
//
// Verifies that sweepStaleUnconfirmedTransactions():
//   - queries pending_payment orders with vcc_job_id IS NULL created > 30 minutes ago
//   - transitions them to 'expired'
//   - emits ORDER_EXPIRED events via event-bus
//   - does NOT expire orders younger than 30 minutes
//   - does NOT expire orders that have a vcc_job_id (payment flow started)
//   - does NOT expire non-pending_payment orders

require('../helpers/env');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { v4: uuidv4 } = require('uuid');
const { db, resetDb } = require('../helpers/app');

const { sweepStaleUnconfirmedTransactions } = require('../../src/jobs');
const eventBus = require('../../src/lib/event-bus');

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedOrder({
  status = 'pending_payment',
  minutesAgo = 0,
  vcc_job_id = null,
  payment_asset = 'usdc_soroban',
} = {}) {
  const id = uuidv4();
  const created = new Date(Date.now() - minutesAgo * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  db.prepare(
    `INSERT INTO orders (id, status, amount_usdc, payment_asset, api_key_id, vcc_job_id, created_at, updated_at)
     VALUES (?, ?, '5.00', ?, NULL, ?, ?, ?)`,
  ).run(id, status, payment_asset, vcc_job_id, created, created);
  return id;
}

function getStatus(id) {
  return db.prepare(`SELECT status FROM orders WHERE id = ?`).get(id)?.status;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sweepStaleUnconfirmedTransactions — expiry', () => {
  beforeEach(() => resetDb());

  it('expires a pending_payment order with no vcc_job_id older than 30 minutes', async () => {
    const id = seedOrder({ minutesAgo: 31, vcc_job_id: null });
    await sweepStaleUnconfirmedTransactions();
    assert.equal(getStatus(id), 'expired');
  });

  it('does NOT expire a pending_payment order younger than 30 minutes', async () => {
    const id = seedOrder({ minutesAgo: 15, vcc_job_id: null });
    await sweepStaleUnconfirmedTransactions();
    assert.equal(getStatus(id), 'pending_payment');
  });

  it('does NOT expire an order that has a vcc_job_id (payment flow started)', async () => {
    const id = seedOrder({ minutesAgo: 60, vcc_job_id: 'job-abc-123' });
    await sweepStaleUnconfirmedTransactions();
    assert.equal(getStatus(id), 'pending_payment');
  });

  it('does NOT expire delivered or failed orders regardless of age', async () => {
    const delivId = seedOrder({ status: 'delivered', minutesAgo: 120 });
    const failId = seedOrder({ status: 'failed', minutesAgo: 120 });
    await sweepStaleUnconfirmedTransactions();
    assert.equal(getStatus(delivId), 'delivered');
    assert.equal(getStatus(failId), 'failed');
  });

  it('expires multiple stale orders in a single pass', async () => {
    const ids = [
      seedOrder({ minutesAgo: 31 }),
      seedOrder({ minutesAgo: 45 }),
      seedOrder({ minutesAgo: 90 }),
    ];
    await sweepStaleUnconfirmedTransactions();
    for (const id of ids) {
      assert.equal(getStatus(id), 'expired', `order ${id} should be expired`);
    }
  });

  it('leaves a 30-minute-old order untouched (boundary: strictly less than cutoff)', async () => {
    // 29 minutes is safely under the 30-minute threshold.
    const id = seedOrder({ minutesAgo: 29 });
    await sweepStaleUnconfirmedTransactions();
    assert.equal(getStatus(id), 'pending_payment');
  });
});

describe('sweepStaleUnconfirmedTransactions — event-bus emissions', () => {
  beforeEach(() => resetDb());

  it('emits ORDER_EXPIRED event for each expired order', async () => {
    const id = seedOrder({ minutesAgo: 35 });
    const received = [];
    const unsubscribe = eventBus.subscribe((evt) => {
      if (evt.type === eventBus.ORDER_EXPIRED) received.push(evt);
    });

    await sweepStaleUnconfirmedTransactions();
    unsubscribe();

    assert.equal(received.length, 1);
    assert.equal(received[0].order_id, id);
    assert.equal(typeof received[0].expired_at, 'string');
    assert.match(received[0].reason, /30 min/i);
  });

  it('emits no events when no orders qualify', async () => {
    seedOrder({ minutesAgo: 5 }); // too recent
    const received = [];
    const unsubscribe = eventBus.subscribe((evt) => {
      if (evt.type === eventBus.ORDER_EXPIRED) received.push(evt);
    });

    await sweepStaleUnconfirmedTransactions();
    unsubscribe();

    assert.equal(received.length, 0);
  });
});
