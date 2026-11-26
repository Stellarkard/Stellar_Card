'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { describe, it } = require('node:test');

const backendDir = path.resolve(__dirname, '../..');

describe('batch ingestion benchmark', () => {
  it('sustains at least a 3x throughput improvement over per-event transactions', () => {
    const result = spawnSync(
      process.execPath,
      ['tooling/bench-batch.js', '--events', '2000', '--batch', '50'],
      { cwd: backendDir, encoding: 'utf8', timeout: 60_000 },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Batch ingestion benchmark/);
    assert.match(result.stdout, /Events:\s+2,000/);
    assert.match(result.stdout, /Batch size:\s+50/);
    assert.match(result.stdout, /Throughput \(TPS\):\s+[\d.]+ transactions\/sec/);
    assert.match(result.stdout, /Speedup:\s+[\d.]+x/);
    assert.match(result.stdout, /Speedup target:\s+3\.00x \(met\)/);
  });
});
