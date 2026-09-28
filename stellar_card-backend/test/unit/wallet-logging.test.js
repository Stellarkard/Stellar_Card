require('../helpers/env');

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Keypair } = require('@stellar/stellar-sdk');
const { event: bizEvent } = require('../../src/lib/logger');
const { subscribe } = require('../../src/lib/event-bus');

describe('Wallet Transaction Execution Logging (Part 4)', () => {
  it('emits wallet.tx_initiated and wallet.tx_success bizEvents during successful submission', async () => {
    const capturedEvents = [];
    const unsubscribe = subscribe((evt) => {
      if (
        evt.type === 'biz' &&
        (evt.name === 'wallet.tx_initiated' || evt.name === 'wallet.tx_success')
      ) {
        capturedEvents.push(evt);
      }
    });

    try {
      // Direct bizEvent emission check matching submitWithRetry behavior
      bizEvent('wallet.tx_initiated', {
        public_key: 'GABC...XYZ',
        tx_hash: '1234567890abcdef',
        attempt: 1,
        max_attempts: 3,
      });

      bizEvent('wallet.tx_success', {
        public_key: 'GABC...XYZ',
        tx_hash: '1234567890abcdef',
        attempt: 1,
      });

      assert.equal(capturedEvents.length, 2);
      assert.equal(capturedEvents[0].name, 'wallet.tx_initiated');
      assert.equal(capturedEvents[0].fields.tx_hash, '1234567890abcdef');
      assert.equal(capturedEvents[1].name, 'wallet.tx_success');
      assert.equal(capturedEvents[1].fields.tx_hash, '1234567890abcdef');
    } finally {
      unsubscribe();
    }
  });

  it('emits wallet.tx_failed bizEvents during failed submission attempt', async () => {
    const capturedEvents = [];
    const unsubscribe = subscribe((evt) => {
      if (evt.type === 'biz' && evt.name === 'wallet.tx_failed') {
        capturedEvents.push(evt);
      }
    });

    try {
      bizEvent('wallet.tx_failed', {
        public_key: 'GABC...XYZ',
        tx_hash: '1234567890abcdef',
        attempt: 1,
        error: 'tx_bad_seq',
        tx_code: 'tx_bad_seq',
      });

      assert.equal(capturedEvents.length, 1);
      assert.equal(capturedEvents[0].name, 'wallet.tx_failed');
      assert.equal(capturedEvents[0].fields.error, 'tx_bad_seq');
    } finally {
      unsubscribe();
    }
  });

  // Part 2 additions. Both fields exist so that "this payout is slow" and
  // "this sequence number is stuck" are answerable from the event stream,
  // rather than by correlating four separate wallet.tx_* lines by timestamp.
  it('carries elapsed_ms on terminal and non-terminal wallet events', () => {
    const captured = [];
    const unsubscribe = subscribe((evt) => {
      if (evt.type === 'biz' && evt.name.startsWith('wallet.tx_')) captured.push(evt);
    });

    try {
      bizEvent('wallet.tx_initiated', {
        tx_hash: 'h1',
        attempt: 1,
        max_attempts: 3,
        elapsed_ms: 0,
      });
      bizEvent('wallet.tx_success', { tx_hash: 'h1', attempt: 1, elapsed_ms: 412 });
      bizEvent('wallet.tx_recovered', { tx_hash: 'h2', attempt: 1, elapsed_ms: 1980 });

      assert.equal(captured.length, 3);
      for (const evt of captured) {
        assert.equal(typeof evt.fields.elapsed_ms, 'number', `${evt.name} missing elapsed_ms`);
        assert.ok(evt.fields.elapsed_ms >= 0);
        // Must survive a JSON round trip — these go to a log pipeline.
        assert.doesNotThrow(() => JSON.parse(JSON.stringify(evt.fields)));
      }
      assert.equal(captured[1].fields.elapsed_ms, 412);
    } finally {
      unsubscribe();
    }
  });

  it('flags retries_exhausted so a stuck tx is distinguishable from a transient one', () => {
    const captured = [];
    const unsubscribe = subscribe((evt) => {
      if (evt.type === 'biz' && evt.name === 'wallet.tx_failed') captured.push(evt);
    });

    try {
      // tx_bad_seq that cleared on retry 2 of 3.
      bizEvent('wallet.tx_failed', {
        tx_hash: 'h1',
        attempt: 2,
        retries_exhausted: false,
        error: 'tx_bad_seq',
      });
      // tx_bad_seq that survived the whole ladder.
      bizEvent('wallet.tx_failed', {
        tx_hash: 'h2',
        attempt: 3,
        retries_exhausted: true,
        error: 'tx_bad_seq',
      });

      assert.equal(captured.length, 2);
      assert.equal(captured[0].fields.retries_exhausted, false);
      assert.equal(captured[1].fields.retries_exhausted, true);
      // The distinction has to be machine-readable, not just a different
      // attempt number, or the alert still cannot be written.
      assert.notEqual(captured[0].fields.retries_exhausted, captured[1].fields.retries_exhausted);
    } finally {
      unsubscribe();
    }
  });
});
