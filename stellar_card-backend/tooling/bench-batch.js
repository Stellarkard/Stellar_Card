#!/usr/bin/env node
'use strict';

// Throughput benchmark for the batch payment-event processor.
//
// It measures the same order-state transition two ways over an identical set
// of pending_payment orders:
//
//   sequential — one `db.transaction(...)` per event, mirroring the
//                one-event-at-a-time ingestion the watcher used to do.
//   batched    — payments/stellar.js::processPaymentEventBatch, which commits
//                one transaction per chunk of up to 50 events.
//
// The delta is pure commit-boundary overhead: both paths run the same UPDATE.
// In WAL mode each commit fsyncs the write-ahead log, so collapsing N commits
// into ceil(N / 50) is where the throughput gain comes from. The script fails
// (non-zero exit) unless the batched path is at least MIN_SPEEDUP (3x) faster.
//
// Run: node tooling/bench-batch.js [--events 2000] [--batch 50]

const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const DEFAULT_EVENTS = 2_000;
const MAX_BATCH_SIZE = 50;
const MIN_SPEEDUP = 3;
const BUSY_TIMEOUT_MS = 5_000;

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function parseArgs(args) {
  const options = { events: DEFAULT_EVENTS, batch: MAX_BATCH_SIZE };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${option}`);
    if (option === '--events') options.events = parsePositiveInteger(value, '--events');
    else if (option === '--batch') options.batch = parsePositiveInteger(value, '--batch');
    else throw new Error(`Unknown option: ${option}`);
  }
  options.batch = Math.min(options.batch, MAX_BATCH_SIZE);
  return options;
}

function makeEvent(orderId, index) {
  return {
    txid: `bench-tx-${index}`,
    orderId,
    paymentAsset: 'usdc_soroban',
    senderAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    index,
  };
}

async function runBenchmark({ events = DEFAULT_EVENTS, batch = MAX_BATCH_SIZE } = {}) {
  events = parsePositiveInteger(events, 'events');
  batch = Math.min(parsePositiveInteger(batch, 'batch'), MAX_BATCH_SIZE);

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'stellar-card-batch-bench-'));
  const dbPath = path.join(tempDir, 'benchmark.sqlite');
  const originalDbPath = process.env.DB_PATH;
  let db;

  try {
    process.env.DB_PATH = dbPath;
    db = require('../src/db');
    const journalMode = db.pragma('journal_mode', { simple: true });
    if (String(journalMode).toLowerCase() !== 'wal') {
      throw new Error(`Expected SQLite WAL mode, got ${journalMode}`);
    }
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
    const { processPaymentEventBatch } = require('../src/payments/stellar');

    // Two disjoint, identically-shaped sets of pending orders so each path
    // starts from the same state and neither is charged the other's work.
    const insert = db.prepare(
      `INSERT INTO orders (id, status, amount_usdc) VALUES (?, 'pending_payment', '10.0000000')`,
    );
    db.transaction(() => {
      for (let index = 0; index < events; index++) {
        insert.run(`seq-${index}`);
        insert.run(`bat-${index}`);
      }
    })();

    const claim = db.prepare(
      `UPDATE orders
          SET status = 'ordering', payment_asset = ?, stellar_txid = ?,
              sender_address = ?, updated_at = ?
        WHERE id = ? AND status = 'pending_payment'`,
    );
    const updatedAt = new Date().toISOString();
    const applyClaim = (event) => {
      const info = claim.run(
        event.paymentAsset,
        event.txid,
        event.senderAddress,
        updatedAt,
        event.orderId,
      );
      if (info.changes !== 1) throw new Error(`claim rejected for order ${event.orderId}`);
      return info.changes;
    };

    const sequentialEvents = Array.from({ length: events }, (_, index) =>
      makeEvent(`seq-${index}`, index),
    );
    const batchedEvents = Array.from({ length: events }, (_, index) =>
      makeEvent(`bat-${index}`, index),
    );

    // Baseline: the same applier, but wrapped so every event is its own
    // transaction — exactly what per-event ingestion costs.
    const claimInOwnTransaction = db.transaction(applyClaim);
    const sequentialStart = performance.now();
    for (const event of sequentialEvents) claimInOwnTransaction(event);
    const sequentialElapsedMs = performance.now() - sequentialStart;

    // Batched: one transaction per chunk of `batch`, savepoint per item.
    const batchedStart = performance.now();
    const summary = processPaymentEventBatch(batchedEvents, applyClaim, { batchSize: batch });
    const batchedElapsedMs = performance.now() - batchedStart;

    const sequentialThroughput = events / (sequentialElapsedMs / 1_000);
    const batchedThroughput = events / (batchedElapsedMs / 1_000);
    const speedup = batchedThroughput / sequentialThroughput;

    const sequentialCommitted = db
      .prepare(`SELECT COUNT(*) AS n FROM orders WHERE id LIKE 'seq-%' AND status = 'ordering'`)
      .get().n;
    const batchedCommitted = db
      .prepare(`SELECT COUNT(*) AS n FROM orders WHERE id LIKE 'bat-%' AND status = 'ordering'`)
      .get().n;

    console.log('\nBatch ingestion benchmark');
    console.log('-------------------------');
    console.log(`Events:                 ${events.toLocaleString()}`);
    console.log(`Batch size:             ${batch}`);
    console.log(`Node.js:                ${process.version}`);
    console.log(`SQLite:                 ${sqliteVersion}`);
    console.log(`Sequential elapsed:     ${sequentialElapsedMs.toFixed(2)} ms`);
    console.log(`Sequential throughput:  ${sequentialThroughput.toFixed(2)} events/sec`);
    console.log(`Batched elapsed:        ${batchedElapsedMs.toFixed(2)} ms`);
    console.log(`Batched throughput:     ${batchedThroughput.toFixed(2)} events/sec`);
    console.log(`Throughput (TPS):       ${batchedThroughput.toFixed(2)} transactions/sec`);
    console.log(`Speedup:                ${speedup.toFixed(2)}x`);
    console.log(
      `Speedup target:         ${MIN_SPEEDUP.toFixed(2)}x (${speedup >= MIN_SPEEDUP ? 'met' : 'MISSED'})`,
    );

    if (sequentialCommitted !== events) {
      throw new Error(`Sequential path committed ${sequentialCommitted}/${events} orders`);
    }
    if (batchedCommitted !== events || summary.failed !== 0 || summary.applied !== events) {
      throw new Error(
        `Batched path committed ${batchedCommitted}/${events} orders ` +
          `(applied=${summary.applied}, failed=${summary.failed})`,
      );
    }
    if (speedup < MIN_SPEEDUP) {
      throw new Error(
        `Batch speedup ${speedup.toFixed(2)}x is below the ${MIN_SPEEDUP}x target`,
      );
    }

    return {
      events,
      batch,
      chunks: summary.chunks,
      sequentialElapsedMs,
      batchedElapsedMs,
      sequentialThroughput,
      batchedThroughput,
      speedup,
    };
  } finally {
    if (db?.open) db.close();
    if (originalDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = originalDbPath;
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    runBenchmark(parseArgs(process.argv.slice(2))).catch((error) => {
      console.error(`Batch benchmark failed: ${error.message}`);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(`Batch benchmark failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { runBenchmark, parseArgs, makeEvent };
