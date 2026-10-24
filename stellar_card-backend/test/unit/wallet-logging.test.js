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

// ── Part 1: events emitted by the real submitWithRetry ──────────────────────
//
// The tests above call bizEvent() directly, so they only prove the event bus
// works. These drive the actual submitWithRetry against a stubbed Horizon
// (same Horizon.Server.prototype patching as xlm-sender.test.js) and assert on
// what it really emits, including the two paths that used to be silent: a
// loadAccount failure and an unresolved network-error outcome.
describe('Wallet Transaction Execution Logging (Part 1): real submitWithRetry', () => {
  const { submitWithRetry } = require('../../src/payments/xlm-sender');
  const {
    Horizon,
    Account,
    TransactionBuilder,
    Networks,
    Operation,
    Asset,
  } = require('@stellar/stellar-sdk');

  const realLoadAccount = Horizon.Server.prototype.loadAccount;
  const realSubmit = Horizon.Server.prototype.submitTransaction;
  const realTransactions = Horizon.Server.prototype.transactions;

  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();
  const masked = `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;

  let captured;
  let unsubscribe;

  beforeEach(() => {
    captured = [];
    unsubscribe = subscribe((evt) => {
      if (evt.type === 'biz' && evt.name.startsWith('wallet.tx_')) captured.push(evt);
    });
  });

  afterEach(() => {
    unsubscribe();
    Horizon.Server.prototype.loadAccount = realLoadAccount;
    Horizon.Server.prototype.submitTransaction = realSubmit;
    Horizon.Server.prototype.transactions = realTransactions;
  });

  const names = () => captured.map((e) => e.name);
  const byName = (name) => captured.filter((e) => e.name === name);

  function buildTx(account) {
    return new TransactionBuilder(account, { fee: '100000', networkPassphrase: Networks.TESTNET })
      .addOperation(
        Operation.payment({
          destination: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          asset: Asset.native(),
          amount: '1.0000000',
        }),
      )
      .setTimeout(60)
      .build();
  }

  function networkError() {
    // No response.data.extras.result_codes: looks like a lost response.
    return new Error('socket hang up');
  }

  function stubLookup(impl) {
    Horizon.Server.prototype.transactions = () => ({
      transaction: () => ({ call: impl }),
    });
  }

  it('success: initiated then success, same tx hash, masked key', async () => {
    Horizon.Server.prototype.loadAccount = async () => new Account(publicKey, '100');
    Horizon.Server.prototype.submitTransaction = async () => ({ hash: 'OK_HASH' });

    const hash = await submitWithRetry(buildTx, keypair);

    assert.equal(hash, 'OK_HASH');
    assert.deepEqual(names(), ['wallet.tx_initiated', 'wallet.tx_success']);
    assert.equal(captured[0].fields.public_key, masked);
    assert.equal(captured[0].fields.attempt, 1);
    assert.equal(captured[0].fields.max_attempts, 3);
    assert.equal(captured[1].fields.tx_hash, 'OK_HASH');
    assert.equal(typeof captured[1].fields.elapsed_ms, 'number');
  });

  it('tx_bad_seq then success: a non-exhausted failure followed by success', async () => {
    let loads = 0;
    Horizon.Server.prototype.loadAccount = async () =>
      new Account(publicKey, String(100 + ++loads));
    let submits = 0;
    Horizon.Server.prototype.submitTransaction = async () => {
      if (++submits === 1) {
        const err = /** @type {any} */ (new Error('bad seq'));
        err.response = { data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } };
        throw err;
      }
      return { hash: 'RETRY_HASH' };
    };

    await submitWithRetry(buildTx, keypair);

    assert.deepEqual(names(), [
      'wallet.tx_initiated',
      'wallet.tx_failed',
      'wallet.tx_initiated',
      'wallet.tx_success',
    ]);
    const [failed] = byName('wallet.tx_failed');
    assert.equal(failed.fields.tx_code, 'tx_bad_seq');
    assert.equal(failed.fields.retries_exhausted, false);
    assert.equal(byName('wallet.tx_initiated')[1].fields.attempt, 2);
  });

  it('logs a loadAccount failure (previously silent) and rethrows it', async () => {
    Horizon.Server.prototype.loadAccount = async () => {
      throw new Error('Horizon unreachable');
    };
    Horizon.Server.prototype.submitTransaction = async () => {
      throw new Error('submit must not run');
    };

    await assert.rejects(submitWithRetry(buildTx, keypair), /Horizon unreachable/);

    assert.deepEqual(names(), ['wallet.tx_load_failed']);
    assert.equal(captured[0].fields.public_key, masked);
    assert.equal(captured[0].fields.attempt, 1);
    assert.equal(captured[0].fields.error, 'Horizon unreachable');
  });

  it('network error + tx never landed: unresolved, retry_safe=true', async () => {
    Horizon.Server.prototype.loadAccount = async () => new Account(publicKey, '100');
    Horizon.Server.prototype.submitTransaction = async () => {
      throw networkError();
    };
    stubLookup(async () => {
      const err = /** @type {any} */ (new Error('Not Found'));
      err.response = { status: 404 };
      throw err;
    });

    await assert.rejects(
      submitWithRetry(buildTx, keypair),
      (err) => err.stellarStatus === 'not_landed',
    );

    assert.deepEqual(names(), ['wallet.tx_initiated', 'wallet.tx_failed', 'wallet.tx_unresolved']);
    const [unresolved] = byName('wallet.tx_unresolved');
    assert.equal(unresolved.fields.stellar_status, 'not_landed');
    assert.equal(unresolved.fields.retry_safe, true);
    assert.equal(unresolved.fields.tx_hash, byName('wallet.tx_initiated')[0].fields.tx_hash);
  });

  it('network error + Horizon lookup also fails: unresolved, retry_safe=false', async () => {
    Horizon.Server.prototype.loadAccount = async () => new Account(publicKey, '100');
    Horizon.Server.prototype.submitTransaction = async () => {
      throw networkError();
    };
    stubLookup(async () => {
      throw new Error('ECONNRESET');
    });

    await assert.rejects(
      submitWithRetry(buildTx, keypair),
      (err) => err.stellarStatus === 'unknown',
    );

    const [unresolved] = byName('wallet.tx_unresolved');
    assert.equal(unresolved.fields.stellar_status, 'unknown');
    assert.equal(
      unresolved.fields.retry_safe,
      false,
      'an unknown outcome must never be marked retry-safe',
    );
    assert.equal(unresolved.fields.lookup_error, 'ECONNRESET');
  });

  it('network error + tx applied but failed: unresolved with the result code', async () => {
    Horizon.Server.prototype.loadAccount = async () => new Account(publicKey, '100');
    Horizon.Server.prototype.submitTransaction = async () => {
      throw networkError();
    };
    stubLookup(async () => ({ successful: false, result_codes: { transaction: 'tx_failed' } }));

    await assert.rejects(
      submitWithRetry(buildTx, keypair),
      (err) => err.stellarStatus === 'applied_failed',
    );

    const [unresolved] = byName('wallet.tx_unresolved');
    assert.equal(unresolved.fields.stellar_status, 'applied_failed');
    assert.equal(unresolved.fields.retry_safe, false);
    assert.equal(unresolved.fields.result_code, 'tx_failed');
  });

  it('network error + tx actually landed: recovered, and no unresolved event', async () => {
    Horizon.Server.prototype.loadAccount = async () => new Account(publicKey, '100');
    Horizon.Server.prototype.submitTransaction = async () => {
      throw networkError();
    };
    stubLookup(async () => ({ successful: true }));

    await submitWithRetry(buildTx, keypair);

    assert.deepEqual(names(), ['wallet.tx_initiated', 'wallet.tx_failed', 'wallet.tx_recovered']);
  });

  it('never puts the full treasury public key into any wallet event', async () => {
    Horizon.Server.prototype.loadAccount = async () => new Account(publicKey, '100');
    Horizon.Server.prototype.submitTransaction = async () => {
      throw networkError();
    };
    stubLookup(async () => {
      throw new Error('ECONNRESET');
    });

    await assert.rejects(submitWithRetry(buildTx, keypair));

    assert.ok(captured.length > 0);
    for (const evt of captured) {
      assert.ok(
        !JSON.stringify(evt.fields).includes(publicKey),
        `${evt.name} leaked the full public key`,
      );
    }
  });
});

// ── Part 5: core configuration — STELLAR_TX_MAX_ATTEMPTS ─────────────────
//
// The retry-ladder length is an ops knob (default 3, validated 1..10). Every
// wallet.tx_* event already carries `max_attempts`, so these tests pin that
// field to the ladder that REALLY ran — including the fallback when ops feeds
// a corrupt value, and the one-time wallet.tx_config_invalid warning that
// makes a misconfiguration traceable instead of silent.
describe('Wallet Transaction Execution Logging (Part 5): configurable retry ladder', () => {
  const { submitWithRetry } = require('../../src/payments/xlm-sender');
  const {
    Horizon,
    Account,
    TransactionBuilder,
    Networks,
    Operation,
    Asset,
  } = require('@stellar/stellar-sdk');

  const realLoadAccount = Horizon.Server.prototype.loadAccount;
  const realSubmit = Horizon.Server.prototype.submitTransaction;

  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();

  let captured;
  let unsubscribe;
  let savedMaxAttempts;

  beforeEach(() => {
    captured = [];
    savedMaxAttempts = process.env.STELLAR_TX_MAX_ATTEMPTS;
    unsubscribe = subscribe((evt) => {
      if (evt.type === 'biz' && evt.name.startsWith('wallet.tx_')) captured.push(evt);
    });
  });

  afterEach(() => {
    if (savedMaxAttempts === undefined) delete process.env.STELLAR_TX_MAX_ATTEMPTS;
    else process.env.STELLAR_TX_MAX_ATTEMPTS = savedMaxAttempts;
    unsubscribe();
    Horizon.Server.prototype.loadAccount = realLoadAccount;
    Horizon.Server.prototype.submitTransaction = realSubmit;
  });

  const byName = (name) => captured.filter((e) => e.name === name);

  function buildTx(account) {
    return new TransactionBuilder(account, { fee: '100000', networkPassphrase: Networks.TESTNET })
      .addOperation(
        Operation.payment({
          destination: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          asset: Asset.native(),
          amount: '1.0000000',
        }),
      )
      .setTimeout(60)
      .build();
  }

  function badSeqError() {
    const err = /** @type {any} */ (new Error('bad seq'));
    err.response = { data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } };
    return err;
  }

  it('uses the default ladder (3) when STELLAR_TX_MAX_ATTEMPTS is unset', async () => {
    delete process.env.STELLAR_TX_MAX_ATTEMPTS;
    Horizon.Server.prototype.loadAccount = async () => new Account(publicKey, '100');
    Horizon.Server.prototype.submitTransaction = async () => ({ hash: 'OK_HASH' });

    await submitWithRetry(buildTx, keypair);

    const [initiated] = byName('wallet.tx_initiated');
    assert.equal(initiated.fields.max_attempts, 3);
  });

  it('honours STELLAR_TX_MAX_ATTEMPTS and reflects it on every event', async () => {
    process.env.STELLAR_TX_MAX_ATTEMPTS = '2';
    let loads = 0;
    Horizon.Server.prototype.loadAccount = async () =>
      new Account(publicKey, String(100 + ++loads));
    Horizon.Server.prototype.submitTransaction = async () => {
      throw badSeqError();
    };

    await assert.rejects(submitWithRetry(buildTx, keypair));

    assert.deepEqual(
      captured.map((e) => e.name),
      ['wallet.tx_initiated', 'wallet.tx_failed', 'wallet.tx_initiated', 'wallet.tx_failed'],
    );
    for (const initiated of byName('wallet.tx_initiated')) {
      assert.equal(initiated.fields.max_attempts, 2);
    }
    const failures = byName('wallet.tx_failed');
    assert.equal(failures[0].fields.retries_exhausted, false);
    assert.equal(failures[1].fields.attempt, 2);
    assert.equal(failures[1].fields.retries_exhausted, true);
  });

  it('accepts a single-attempt ladder: one failure is immediately terminal', async () => {
    process.env.STELLAR_TX_MAX_ATTEMPTS = '1';
    Horizon.Server.prototype.loadAccount = async () => new Account(publicKey, '100');
    Horizon.Server.prototype.submitTransaction = async () => {
      throw badSeqError();
    };

    await assert.rejects(submitWithRetry(buildTx, keypair));

    assert.deepEqual(
      captured.map((e) => e.name),
      ['wallet.tx_initiated', 'wallet.tx_failed'],
    );
    assert.equal(byName('wallet.tx_initiated')[0].fields.max_attempts, 1);
    assert.equal(byName('wallet.tx_failed')[0].fields.retries_exhausted, true);
  });

  it('falls back to 3 and emits wallet.tx_config_invalid on a corrupt value', async () => {
    process.env.STELLAR_TX_MAX_ATTEMPTS = 'bogus';
    Horizon.Server.prototype.loadAccount = async () => new Account(publicKey, '100');
    Horizon.Server.prototype.submitTransaction = async () => ({ hash: 'OK_HASH' });

    await submitWithRetry(buildTx, keypair);

    const [warning] = byName('wallet.tx_config_invalid');
    assert.ok(warning, 'expected one wallet.tx_config_invalid warning');
    assert.equal(warning.fields.raw_value, 'bogus');
    assert.equal(warning.fields.fallback_max_attempts, 3);
    assert.equal(byName('wallet.tx_initiated')[0].fields.max_attempts, 3);
  });

  it('rejects out-of-range and fractional configs, always running the default ladder', async () => {
    for (const bad of ['0', '11', '-1', '2.5', 'three']) {
      process.env.STELLAR_TX_MAX_ATTEMPTS = bad;
      Horizon.Server.prototype.loadAccount = async () => new Account(publicKey, '100');
      Horizon.Server.prototype.submitTransaction = async () => ({ hash: 'OK_HASH' });
      await submitWithRetry(buildTx, keypair);
    }
    for (const initiated of byName('wallet.tx_initiated')) {
      assert.equal(initiated.fields.max_attempts, 3, 'corrupt config must never change the ladder');
    }
  });
});
