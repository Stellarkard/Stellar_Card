// Integration test for high-throughput batch payment ingestion — exercises
// payments/stellar.js::processPaymentEventBatch against the real SQLite
// connection (src/db), which test/helpers/env.js points at an in-memory
// database so the assertions run on actual transactions, savepoints and rows
// rather than a stub.
//
// The properties under test:
//   1. Atomic ingestion — a batch of events claims every matching pending
//      order, committing in a single transaction per chunk of 50.
//   2. Failure isolation — one bad event inside a chunk must not roll back
//      the independent valid orders that share the chunk, and must not stop
//      later chunks from committing.
//   3. Non-Error throws and empty batches degrade safely.

require('../helpers/env');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../src/db');
const { processPaymentEventBatch, _BATCH_SIZE } = require('../../src/payments/stellar');

// The per-event order-state update the batcher drives. This is the DB-only
// subset of payment-handler.js::handlePayment — the pending_payment →
// ordering claim — which is exactly the synchronous work that is safe to run
// inside a batch transaction.
const claimOrder = db.prepare(
  `UPDATE orders
      SET status = 'ordering', payment_asset = ?, stellar_txid = ?,
          sender_address = ?, updated_at = ?
    WHERE id = ? AND status = 'pending_payment'`,
);
const insertOrder = db.prepare(
  `INSERT INTO orders (id, status, amount_usdc) VALUES (?, 'pending_payment', '10.0000000')`,
);

function claimApplier(event) {
  const info = claimOrder.run(
    event.paymentAsset,
    event.txid,
    event.senderAddress,
    new Date().toISOString(),
    event.orderId,
  );
  if (info.changes !== 1) throw new Error(`claim rejected for order ${event.orderId}`);
  return info.changes;
}

function seedOrders(ids) {
  db.transaction(() => {
    for (const id of ids) insertOrder.run(id);
  })();
}

function makeEvents(ids) {
  return ids.map((id, i) => ({
    txid: `TX-${id}`,
    orderId: id,
    paymentAsset: 'usdc_soroban',
    senderAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    index: i,
  }));
}

function countByStatus(status) {
  return db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = ?`).get(status).n;
}

beforeEach(() => {
  db.prepare(`DELETE FROM orders`).run();
});

describe('processPaymentEventBatch — atomic batch ingestion', () => {
  it('commits a full 50-event chunk in one transaction', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `one-${i}`);
    seedOrders(ids);

    const summary = processPaymentEventBatch(makeEvents(ids), claimApplier);

    assert.equal(_BATCH_SIZE, 50);
    assert.equal(summary.total, 50);
    assert.equal(summary.applied, 50);
    assert.equal(summary.failed, 0);
    assert.equal(summary.chunks, 1);
    assert.equal(countByStatus('ordering'), 50);
    assert.equal(countByStatus('pending_payment'), 0);
  });

  it('splits 120 events into three committed chunks', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `many-${i}`);
    seedOrders(ids);

    const summary = processPaymentEventBatch(makeEvents(ids), claimApplier);

    assert.equal(summary.chunks, 3);
    assert.equal(summary.applied, 120);
    // Every order transitioned and every write committed — no chunk was lost.
    assert.equal(countByStatus('ordering'), 120);
    assert.equal(summary.results.length, 120);
  });

  it('accepts a custom batch size', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `small-${i}`);
    seedOrders(ids);

    const summary = processPaymentEventBatch(makeEvents(ids), claimApplier, { batchSize: 4 });

    assert.equal(summary.chunks, 3); // ceil(10 / 4)
    assert.equal(summary.applied, 10);
  });

  it('is a no-op for an empty batch', () => {
    const summary = processPaymentEventBatch([], claimApplier);
    assert.deepEqual(summary, { total: 0, applied: 0, failed: 0, chunks: 0, results: [] });
  });
});

describe('processPaymentEventBatch — failure isolation', () => {
  it('keeps valid orders in the same chunk when one event fails', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `ok-${i}`);
    seedOrders(ids);

    const events = makeEvents(ids);
    // Poison event planted in the middle of chunk 2 (indices 50..99). Its
    // neighbours must still commit.
    events.splice(60, 0, {
      txid: 'TX-POISON',
      orderId: 'unknown-order',
      paymentAsset: 'usdc_soroban',
      senderAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      index: 60,
    });

    const summary = processPaymentEventBatch(events, claimApplier);

    assert.equal(summary.total, 121);
    assert.equal(summary.chunks, 3); // ceil(121 / 50)
    assert.equal(summary.applied, 120);
    assert.equal(summary.failed, 1);

    const failed = summary.results.filter((r) => !r.ok);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].item.orderId, 'unknown-order');
    assert.match(failed[0].error, /claim rejected/);

    // The failing item's chunk neighbours committed: all 120 valid orders
    // are in 'ordering'. A whole-chunk rollback would have left ~50 of them
    // back in 'pending_payment'.
    assert.equal(countByStatus('ordering'), 120);
    assert.equal(countByStatus('pending_payment'), 0);
  });

  it('does not let an all-failing chunk stop a later chunk', () => {
    const validIds = Array.from({ length: 50 }, (_, i) => `solo-${i}`);
    seedOrders(validIds);

    // 50 unknown orders occupy chunk 1; the 50 real orders form chunk 2.
    const missing = Array.from({ length: 50 }, (_, i) => `missing-${i}`);
    const events = [...makeEvents(missing), ...makeEvents(validIds)];

    const summary = processPaymentEventBatch(events, claimApplier);

    assert.equal(summary.chunks, 2);
    assert.equal(summary.failed, 50);
    assert.equal(summary.applied, 50);
    assert.equal(countByStatus('ordering'), 50);
  });

  it('reports a non-Error throw and still commits its neighbours', () => {
    const ids = ['n-0', 'n-1', 'n-2'];
    seedOrders(ids);
    const events = makeEvents(ids);

    // All three share one chunk; only the middle event throws, and it throws
    // a bare string rather than an Error.
    const applier = (event) => {
      if (event.orderId === 'n-1') throw 'bare string failure';
      return claimApplier(event);
    };
    const summary = processPaymentEventBatch(events, applier);

    assert.equal(summary.applied, 2);
    assert.equal(summary.failed, 1);
    assert.equal(summary.results[1].error, 'bare string failure');
    assert.equal(countByStatus('ordering'), 2);
    assert.equal(countByStatus('pending_payment'), 1);
  });

  it('invokes onItemError with the offending event', () => {
    seedOrders(['onerr-0']);
    const seen = [];
    processPaymentEventBatch(
      [
        { txid: 'TX-A', orderId: 'onerr-0', paymentAsset: 'usdc_soroban', senderAddress: 'G' },
        { txid: 'TX-B', orderId: 'onerr-missing', paymentAsset: 'usdc_soroban', senderAddress: 'G' },
      ],
      claimApplier,
      { onItemError: (err, item) => seen.push([err.message, item.orderId]) },
    );

    assert.equal(seen.length, 1);
    assert.equal(seen[0][1], 'onerr-missing');
  });
});
