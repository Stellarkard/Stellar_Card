// @ts-check
// High-throughput batch ingestion for Soroban payment events.
//
// payments/stellar.js dispatches events one at a time — `await
// handlePaymentEvent(event, ...)` — and every event that writes to SQLite runs
// in its own implicit transaction. With WAL journalling and the default
// `synchronous = FULL`, each of those commits costs an fsync, so a burst of N
// payments pays N commit round-trips before the watcher's cursor can advance.
//
// This module batches the database portion of that work. Events are cut into
// chunks of at most BATCH_SIZE (50) and each chunk runs inside a single
// `db.transaction(...)`, so the number of commit boundaries scales with the
// chunk count rather than the event count.
//
// Isolation, not all-or-nothing
// -----------------------------
// Rolling the whole chunk back because one item failed would be wrong: a
// single malformed payment must not un-claim the dozens of valid orders that
// happen to share its chunk. Each item therefore runs inside its own
// SAVEPOINT. If the item's work throws — constraint violation, corrupt row,
// hostile value — the processor rolls back to that savepoint, records the
// failure and moves on; the outer transaction still commits every item that
// succeeded.
//
// Only an unexpected failure of the transaction machinery itself (disk full,
// SQLITE_BUSY that outlives busy_timeout) aborts a chunk. In that case every
// item in the chunk is reported as failed rather than letting the caller
// believe a rolled-back write landed.
//
// The processor is dependency-injected: it needs a better-sqlite3 handle (or
// anything exposing `transaction` and `exec`) plus an `applyItem` callback
// that performs one item's writes. Nothing here reaches the network, so the
// batching semantics are exercisable without a live chain.

const DEFAULT_BATCH_SIZE = 50;
// Ceiling for a configured batch size. 50 is the size the watcher targets;
// capping here stops a caller from accidentally building a thousand-item
// transaction that holds the write lock for an unbounded stretch.
const MAX_BATCH_SIZE = 50;

/**
 * @typedef {Object} BatchItemResult
 * @property {boolean} ok              true when applyItem returned normally
 * @property {unknown} item            the input item, echoed back
 * @property {unknown} [value]         applyItem's return value when ok
 * @property {unknown} [cause]         the thrown value when not ok
 * @property {string} [error]          printable message when not ok
 * @property {boolean} [chunkAborted]  true when the whole chunk rolled back
 */

/**
 * @typedef {Object} BatchSummary
 * @property {number} total             items submitted
 * @property {number} applied           items whose writes committed
 * @property {number} failed            items rolled back (or in an aborted chunk)
 * @property {number} chunks            transactions opened
 * @property {BatchItemResult[]} results  per-item outcomes, in input order
 */

/**
 * Extract a printable message from anything that can be thrown, including
 * non-Error values and Errors whose `.message` getter throws. Mirrors
 * payment-handler.js::safeErrorMessage.
 * @param {unknown} err
 * @returns {string}
 */
function safeErrorMessage(err) {
  if (err === null) return 'null';
  if (err === undefined) return 'undefined';
  if (typeof err === 'string') return err;
  try {
    if (err instanceof Error && typeof err.message === 'string') return err.message;
    return String(err);
  } catch {
    return '<unstringifiable error>';
  }
}

/**
 * JSON replacer that renders BigInt as a string — i128 payment amounts travel
 * through these fields and `JSON.stringify` throws on a bare BigInt.
 * @param {string} _key
 * @param {unknown} value
 * @returns {unknown}
 */
function bigintReplacer(_key, value) {
  return typeof value === 'bigint' ? String(value) : value;
}

/**
 * Default log sink used when the caller does not inject one. A batch must
 * never fail silently, so this falls back to the console rather than a no-op.
 * @param {string} level
 * @param {string} message
 * @param {Record<string, unknown>} [fields]
 */
function defaultBatchLog(level, message, fields) {
  let extra = '';
  if (fields) {
    try {
      extra = ` ${JSON.stringify(fields, bigintReplacer)}`;
    } catch {
      extra = ' <unserialisable fields>';
    }
  }
  const line = `[batch-processor] ${level}: ${message}${extra}`;
  if (level === 'error') console.error(line);
  else console.warn(line);
}

/**
 * Best-effort correlation fields for a failed item so the log line points at
 * a payment rather than an opaque object. Falls back to a stringified item
 * when nothing recognisable is present.
 * @param {unknown} item
 * @returns {Record<string, unknown>}
 */
function itemRef(item) {
  if (item && typeof item === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (item);
    /** @type {Record<string, unknown>} */
    const ref = {};
    if (obj.txid !== undefined) ref.txid = obj.txid;
    if (obj.orderId !== undefined) ref.order_id = obj.orderId;
    if (Object.keys(ref).length > 0) return ref;
  }
  try {
    return { item: String(item) };
  } catch {
    return { item: '<unstringifiable item>' };
  }
}

/**
 * Coerce a batch size to an integer in [1, MAX_BATCH_SIZE], falling back to
 * DEFAULT_BATCH_SIZE when the value is unusable (NaN, zero, negative).
 * @param {unknown} size
 * @returns {number}
 */
function normalizeBatchSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.trunc(n), MAX_BATCH_SIZE);
}

/**
 * Split `items` into consecutive chunks of at most `size` elements. Non-array
 * input yields an empty result rather than throwing.
 * @param {unknown} items
 * @param {number} [size]
 * @returns {unknown[][]}
 */
function chunk(items, size = DEFAULT_BATCH_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const limit = normalizeBatchSize(size);
  /** @type {unknown[][]} */
  const out = [];
  for (let i = 0; i < list.length; i += limit) out.push(list.slice(i, i + limit));
  return out;
}

/**
 * Run one chunk's items inside a single database transaction, isolating each
 * item behind its own savepoint so one failure cannot roll back its
 * neighbours.
 * @param {{ transaction: Function, exec: Function }} database
 * @param {unknown[]} rows
 * @param {(item: unknown) => unknown} applyItem
 * @param {(level: string, message: string, fields?: Record<string, unknown>) => void} log
 * @param {((err: unknown, item: unknown) => void) | undefined} onItemError
 * @returns {BatchItemResult[]}
 */
function runChunk(database, rows, applyItem, log, onItemError) {
  /** @type {BatchItemResult[]} */
  const results = [];

  const runChunkTxn = database.transaction((group) => {
    let seq = 0;
    for (const item of group) {
      // Savepoint names cannot be bound as parameters, so they are
      // interpolated. Uniqueness only needs to hold within this transaction.
      const savepoint = `batch_item_${seq++}`;
      database.exec(`SAVEPOINT ${savepoint}`);
      try {
        const value = applyItem(item);
        database.exec(`RELEASE ${savepoint}`);
        results.push({ ok: true, item, value });
      } catch (err) {
        // Undo only this item's writes, then hand the outer transaction back
        // so it can keep committing its neighbours.
        try {
          database.exec(`ROLLBACK TO ${savepoint}`);
        } catch {
          /* savepoint already unwound with the failed statement */
        }
        try {
          database.exec(`RELEASE ${savepoint}`);
        } catch {
          /* idem */
        }
        const message = safeErrorMessage(err);
        results.push({ ok: false, item, error: message, cause: err });
        log('warn', 'stellar.batch_item_failed', { error: message, ...itemRef(item) });
        if (onItemError) {
          try {
            onItemError(err, item);
          } catch {
            /* an observer must never abort the batch */
          }
        }
      }
    }
  });

  try {
    runChunkTxn(rows);
  } catch (err) {
    // The transaction machinery itself failed — the whole chunk rolled back.
    // Report every item as failed rather than returning a partially-filled
    // result set that implies writes which never committed.
    const message = safeErrorMessage(err);
    log('error', 'stellar.batch_chunk_aborted', { error: message, size: rows.length });
    return rows.map((item) => ({
      ok: false,
      item,
      error: message,
      cause: err,
      chunkAborted: true,
    }));
  }
  return results;
}

/**
 * Build a reusable batch processor bound to one database handle.
 * @param {Object} [options]
 * @param {{ transaction: Function, exec: Function }} options.database
 * @param {number} [options.batchSize]   max items per transaction (clamped to 50)
 * @param {(level: string, message: string, fields?: Record<string, unknown>) => void} [options.log]
 * @param {(err: unknown, item: unknown) => void} [options.onItemError]
 * @returns {{ processBatch: (items: unknown, applyItem: (item: unknown) => unknown) => BatchSummary, batchSize: number }}
 */
function createBatchProcessor(options = {}) {
  const {
    database,
    batchSize = DEFAULT_BATCH_SIZE,
    log = defaultBatchLog,
    onItemError,
  } = options;
  if (
    !database ||
    typeof database.transaction !== 'function' ||
    typeof database.exec !== 'function'
  ) {
    throw new TypeError('createBatchProcessor: database with transaction()/exec() is required');
  }
  const limit = normalizeBatchSize(batchSize);

  /**
   * Apply `applyItem` to every item, one transaction per chunk of `limit`.
   * @param {unknown} items
   * @param {(item: unknown) => unknown} applyItem
   * @returns {BatchSummary}
   */
  function processBatch(items, applyItem) {
    if (typeof applyItem !== 'function') {
      throw new TypeError('processBatch: applyItem must be a function');
    }
    const rows = Array.isArray(items) ? items : [];
    /** @type {BatchSummary} */
    const summary = { total: rows.length, applied: 0, failed: 0, chunks: 0, results: [] };
    if (rows.length === 0) return summary;

    for (const group of chunk(rows, limit)) {
      const groupResults = runChunk(database, group, applyItem, log, onItemError);
      summary.chunks += 1;
      for (const result of groupResults) {
        summary.results.push(result);
        if (result.ok) summary.applied += 1;
        else summary.failed += 1;
      }
    }
    return summary;
  }

  return { processBatch, batchSize: limit };
}

/**
 * One-shot convenience wrapper around createBatchProcessor for callers that
 * do not need to reuse the processor.
 * @param {{ transaction: Function, exec: Function }} database
 * @param {unknown} items
 * @param {(item: unknown) => unknown} applyItem
 * @param {Object} [options]
 * @param {number} [options.batchSize]
 * @param {(level: string, message: string, fields?: Record<string, unknown>) => void} [options.log]
 * @param {(err: unknown, item: unknown) => void} [options.onItemError]
 * @returns {BatchSummary}
 */
function processBatch(database, items, applyItem, options = {}) {
  return createBatchProcessor({ database, ...options }).processBatch(items, applyItem);
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  normalizeBatchSize,
  chunk,
  createBatchProcessor,
  processBatch,
};
