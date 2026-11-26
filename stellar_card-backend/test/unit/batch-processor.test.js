// Unit tests for backend/src/payments/batch-processor.js — the transactional
// batch-ingestion engine.
//
// These exercise the batching contract without a SQLite dependency by driving
// the processor through a fake database that records the transaction and
// savepoint boundary calls. The real-SQLite integration behaviour (atomic
// commit, per-item isolation against actual rows) lives in
// test/integration/batch-ingestion.test.js.
//
// What is pinned here:
//   - chunking: consecutive chunks of at most DEFAULT_BATCH_SIZE (50)
//   - one transaction per chunk, savepoint per item
//   - per-item isolation: a throwing item rolls back to its savepoint and the
//     neighbours in the same chunk still count as applied
//   - whole-chunk abort: if the transaction machinery throws, every item in
//     that chunk is reported failed (not silently half-applied)
//   - result ordering matches input ordering
//   - hostile inputs (non-Error throws, non-array items, bad batch sizes)

require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  normalizeBatchSize,
  chunk,
  createBatchProcessor,
  processBatch,
} = require('../../src/payments/batch-processor');

// ── Fake database ───────────────────────────────────────────────────────────
//
// Records the boundary calls the processor makes so a test can assert on the
// transaction/savepoint structure without a real SQLite handle. `onTransaction`
// is an escape hatch for the whole-chunk-abort case.
function makeFakeDb({ onTransaction } = {}) {
  const calls = { transactions: 0, exec: [] };
  /** @type {any} */
  const db = {
    calls,
    transaction(fn) {
      return (...args) => {
        calls.transactions += 1;
        if (onTransaction) return onTransaction(fn, args);
        return fn(...args);
      };
    },
    exec(sql) {
      calls.exec.push(sql);
    },
  };
  return db;
}

function silentLog() {
  /* no-op */
}

function makeItems(n) {
  return Array.from({ length: n }, (_, i) => ({ index: i }));
}

// ── normalizeBatchSize ──────────────────────────────────────────────────────

describe('normalizeBatchSize', () => {
  it('defaults unusable values to DEFAULT_BATCH_SIZE', () => {
    for (const bad of [undefined, null, 0, -1, NaN, 'abc', {}]) {
      assert.equal(normalizeBatchSize(bad), DEFAULT_BATCH_SIZE);
    }
  });

  it('truncates fractional sizes', () => {
    assert.equal(normalizeBatchSize(10.9), 10);
  });

  it('clamps anything above MAX_BATCH_SIZE', () => {
    assert.equal(normalizeBatchSize(500), MAX_BATCH_SIZE);
    assert.equal(normalizeBatchSize(DEFAULT_BATCH_SIZE), DEFAULT_BATCH_SIZE);
  });
});

// ── chunk ───────────────────────────────────────────────────────────────────

describe('chunk', () => {
  it('returns no chunks for an empty or non-array input', () => {
    assert.deepEqual(chunk([]), []);
    assert.deepEqual(chunk(null), []);
    assert.deepEqual(chunk(undefined), []);
    assert.deepEqual(chunk('not-an-array'), []);
  });

  it('keeps a short list in a single chunk', () => {
    const items = makeItems(7);
    const chunks = chunk(items, 50);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].length, 7);
  });

  it('splits at exactly the batch size', () => {
    const chunks = chunk(makeItems(50), 50);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].length, 50);
  });

  it('splits a remainder into a trailing chunk', () => {
    const chunks = chunk(makeItems(120), 50);
    assert.equal(chunks.length, 3);
    assert.deepEqual(
      chunks.map((c) => c.length),
      [50, 50, 20],
    );
  });

  it('preserves order across chunk boundaries', () => {
    const chunks = chunk(makeItems(5), 2);
    assert.deepEqual(
      chunks.map((c) => c.map((i) => i.index)),
      [
        [0, 1],
        [2, 3],
        [4],
      ],
    );
  });
});

// ── createBatchProcessor guards ─────────────────────────────────────────────

describe('createBatchProcessor — argument guards', () => {
  it('rejects a missing / malformed database', () => {
    assert.throws(() => createBatchProcessor({}), TypeError);
    assert.throws(() => createBatchProcessor({ database: {} }), TypeError);
  });

  it('rejects a missing applyItem', () => {
    const processor = createBatchProcessor({ database: makeFakeDb() });
    assert.throws(() => processor.processBatch([1, 2], undefined), TypeError);
  });
});

// ── processBatch — happy path and batching structure ────────────────────────

describe('processBatch — batching structure', () => {
  it('is a no-op for an empty batch', () => {
    const db = makeFakeDb();
    const summary = processBatch(db, [], () => {});
    assert.deepEqual(summary, { total: 0, applied: 0, failed: 0, chunks: 0, results: [] });
    assert.equal(db.calls.transactions, 0);
  });

  it('opens one transaction per chunk of 50', () => {
    const db = makeFakeDb();
    const summary = processBatch(db, makeItems(120), () => 'ok', { log: silentLog });

    assert.equal(summary.total, 120);
    assert.equal(summary.applied, 120);
    assert.equal(summary.failed, 0);
    assert.equal(summary.chunks, 3);
    // Three chunks => three transactions, regardless of the 120 items.
    assert.equal(db.calls.transactions, 3);
  });

  it('honours a custom batch size', () => {
    const db = makeFakeDb();
    const summary = processBatch(db, makeItems(10), () => {}, {
      batchSize: 3,
      log: silentLog,
    });
    assert.equal(summary.chunks, 4);
    assert.equal(db.calls.transactions, 4);
  });

  it('wraps each item in its own savepoint', () => {
    const db = makeFakeDb();
    processBatch(db, makeItems(2), () => {}, { log: silentLog });
    assert.deepEqual(db.calls.exec, [
      'SAVEPOINT batch_item_0',
      'RELEASE batch_item_0',
      'SAVEPOINT batch_item_1',
      'RELEASE batch_item_1',
    ]);
  });

  it('echoes applyItem results and keeps input order', () => {
    const db = makeFakeDb();
    const summary = processBatch(db, makeItems(5), (item) => item.index * 2, {
      log: silentLog,
    });
    assert.deepEqual(
      summary.results.map((r) => r.value),
      [0, 2, 4, 6, 8],
    );
    assert.deepEqual(
      summary.results.map((r) => r.item.index),
      [0, 1, 2, 3, 4],
    );
  });

  it('reuses the processor across calls', () => {
    const db = makeFakeDb();
    const processor = createBatchProcessor({ database: db, log: silentLog });
    assert.equal(processor.batchSize, DEFAULT_BATCH_SIZE);
    processor.processBatch(makeItems(3), () => {});
    processor.processBatch(makeItems(4), () => {});
    assert.equal(db.calls.transactions, 2);
  });
});

// ── Per-item isolation ──────────────────────────────────────────────────────

describe('processBatch — per-item isolation', () => {
  it('keeps neighbours applied when an item throws', () => {
    const db = makeFakeDb();
    const poison = new Set([2, 57]);
    const summary = processBatch(
      db,
      makeItems(120),
      (item) => {
        if (poison.has(item.index)) throw new Error(`bad item ${item.index}`);
        return item.index;
      },
      { log: silentLog },
    );

    assert.equal(summary.applied, 118);
    assert.equal(summary.failed, 2);
    const failed = summary.results.filter((r) => !r.ok);
    assert.deepEqual(
      failed.map((r) => r.item.index),
      [2, 57],
    );
    assert.match(failed[0].error, /bad item 2/);
    // A failure in chunk 1 (index 2) did not abort chunk 2 (index 57) or the
    // remaining items.
    assert.equal(summary.chunks, 3);
    assert.equal(db.calls.transactions, 3);
  });

  it('rolls back to the failing item savepoint and releases it', () => {
    const db = makeFakeDb();
    processBatch(
      db,
      makeItems(2),
      (item) => {
        if (item.index === 0) throw new Error('boom');
      },
      { log: silentLog },
    );
    assert.deepEqual(db.calls.exec, [
      'SAVEPOINT batch_item_0',
      'ROLLBACK TO batch_item_0',
      'RELEASE batch_item_0',
      'SAVEPOINT batch_item_1',
      'RELEASE batch_item_1',
    ]);
  });

  it('reports a non-Error throw with a printable message', () => {
    const db = makeFakeDb();
    const summary = processBatch(
      db,
      makeItems(1),
      () => {
        throw 'string failure';
      },
      { log: silentLog },
    );
    assert.equal(summary.failed, 1);
    assert.equal(summary.results[0].error, 'string failure');
  });

  it('survives an item whose error message getter throws', () => {
    const db = makeFakeDb();
    const hostile = {
      get message() {
        throw new Error('nope');
      },
    };
    const summary = processBatch(
      db,
      makeItems(1),
      () => {
        throw hostile;
      },
      { log: silentLog },
    );
    assert.equal(summary.failed, 1);
    assert.equal(typeof summary.results[0].error, 'string');
  });
});

// ── Callbacks ───────────────────────────────────────────────────────────────

describe('processBatch — callbacks', () => {
  it('invokes onItemError for each failure with the item', () => {
    const db = makeFakeDb();
    const seen = [];
    processBatch(
      db,
      makeItems(3),
      (item) => {
        if (item.index === 1) throw new Error('x');
      },
      { log: silentLog, onItemError: (err, item) => seen.push([err.message, item.index]) },
    );
    assert.deepEqual(seen, [['x', 1]]);
  });

  it('routes failures through the injected logger', () => {
    const db = makeFakeDb();
    const lines = [];
    processBatch(db, [{ txid: 'TX1', orderId: 'order-1' }], () => {
      throw new Error('boom');
    }, { log: (level, message, fields) => lines.push({ level, message, fields }) });

    assert.equal(lines.length, 1);
    assert.equal(lines[0].level, 'warn');
    assert.equal(lines[0].message, 'stellar.batch_item_failed');
    assert.equal(lines[0].fields.txid, 'TX1');
    assert.equal(lines[0].fields.order_id, 'order-1');
  });

  it('ignores an onItemError that itself throws', () => {
    const db = makeFakeDb();
    const summary = processBatch(
      db,
      makeItems(2),
      (item) => {
        if (item.index === 0) throw new Error('boom');
      },
      {
        log: silentLog,
        onItemError: () => {
          throw new Error('observer blew up');
        },
      },
    );
    assert.equal(summary.applied, 1);
    assert.equal(summary.failed, 1);
  });
});

// ── Whole-chunk abort ───────────────────────────────────────────────────────

describe('processBatch — whole-chunk abort', () => {
  it('reports every item in the aborted chunk as failed', () => {
    const db = makeFakeDb({
      onTransaction() {
        throw new Error('disk full');
      },
    });
    const summary = processBatch(db, makeItems(4), () => {}, { log: silentLog });

    assert.equal(summary.applied, 0);
    assert.equal(summary.failed, 4);
    assert.ok(summary.results.every((r) => r.chunkAborted === true));
    assert.match(summary.results[0].error, /disk full/);
  });

  it('does not abort later chunks when an early chunk fails', () => {
    let transactionCount = 0;
    const db = makeFakeDb({
      onTransaction(fn, args) {
        transactionCount += 1;
        // Abort only the first chunk.
        if (transactionCount === 1) throw new Error('first chunk died');
        return fn(...args);
      },
    });
    const summary = processBatch(db, makeItems(120), () => {}, { log: silentLog });

    assert.equal(summary.chunks, 3);
    // Chunk 1 is lost, chunks 2 and 3 applied.
    assert.equal(summary.failed, 50);
    assert.equal(summary.applied, 70);
  });
});
