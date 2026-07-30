// Unit tests for Sentry reporting from work that has no request behind
// it (issue #9).
//
// ── Why this is a separate file from sentry-config.test.js ─────────────
//
// `initialized` in lib/sentry-config.js is module state, set once by
// initSentry() and never cleared — deliberately, since a process
// initialises Sentry at boot and lives with the answer. Every existing
// suite in sentry-config.test.js therefore exercises the DISABLED path,
// and flipping the flag partway through that file would make its results
// depend on declaration order.
//
// node:test runs one process per file, so this file gets its own module
// registry: it can initialise for real and then assert on what the SDK
// was asked to send. Nothing leaves the process — no DSN reachable from
// a test would resolve, and the transport is replaced below anyway.

require('../helpers/env');

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const sentry = require('../../src/lib/sentry-config');

// A syntactically valid DSN pointing nowhere. buildSentryOptions is what
// decides sampling and integrations; DSN_SHAPE is what decides whether
// initSentry accepts it at all.
const FAKE_DSN = 'https://abc123@o0.ingest.sentry.io/1234567';

// initSentry() only proceeds under NODE_ENV=production. The env helper
// sets NODE_ENV=test, so pass the environment explicitly rather than
// mutating process.env — every other module in the process is entitled
// to keep believing it is a test run.
const initialised = sentry.initSentry({ NODE_ENV: 'production', SENTRY_DSN: FAKE_DSN });

/**
 * Replace Sentry.captureException with a recorder and return the calls.
 *
 * `sentry.Sentry` is the @sentry/node module object, and the helpers in
 * sentry-config.js resolve `Sentry.captureException` at call time off
 * that same object — so assigning to it is enough, and no bundler-style
 * import rewriting is involved.
 */
function recordCaptures() {
  /** @type {{ error: unknown, options: any, scope: any }[]} */
  const calls = [];
  /** @type {any} */ const S = sentry.Sentry;

  const realCapture = S.captureException;
  const realWithScope = S.withScope;

  /** @type {any} */ let activeScope = null;

  S.withScope = (fn) => {
    activeScope = {
      user: undefined,
      tags: /** @type {Record<string, unknown>} */ ({}),
      contexts: /** @type {Record<string, unknown>} */ ({}),
      setUser(value) {
        this.user = value;
        return this;
      },
      setTag(key, value) {
        this.tags[key] = value;
        return this;
      },
      setContext(key, value) {
        this.contexts[key] = value;
        return this;
      },
    };
    return fn(activeScope);
  };

  S.captureException = (error, options) => {
    calls.push({ error, options, scope: activeScope });
    return 'event-id';
  };

  return {
    calls,
    restore() {
      S.captureException = realCapture;
      S.withScope = realWithScope;
    },
  };
}

describe('reportBackgroundFailure — preconditions', () => {
  it('initialises against a well-formed DSN', () => {
    // Everything below is vacuous if this is false: the helper is a
    // documented no-op while disabled, so the assertions would pass
    // against a function that does nothing.
    assert.equal(initialised, true, 'initSentry must accept a well-formed DSN');
    assert.equal(sentry.isEnabled(), true);
  });
});

describe('reportBackgroundFailure', () => {
  /** @type {ReturnType<typeof recordCaptures>} */ let rec;

  beforeEach(() => {
    if (rec) rec.restore();
    rec = recordCaptures();
  });

  it('reports the error at error level', () => {
    const err = new Error('pruner exploded');
    const id = sentry.reportBackgroundFailure('jobs', 'pruneIdempotencyKeys', err);

    assert.equal(id, 'event-id', 'the event id is returned to the caller');
    assert.equal(rec.calls.length, 1);
    assert.equal(rec.calls[0].error, err, 'the original error object is sent, not a copy');
    assert.equal(rec.calls[0].options.level, 'error');
  });

  it('tags subsystem and operation so failures group separately', () => {
    // Background work has no transaction name, so without these tags
    // every job failure lands in one Sentry issue and "the webhook retry
    // loop is broken" is indistinguishable from "the pruner is broken".
    sentry.reportBackgroundFailure('jobs', 'retryWebhooks', new Error('x'));
    const { scope } = rec.calls[0];
    assert.equal(scope.tags.subsystem, 'jobs');
    assert.equal(scope.tags.operation, 'retryWebhooks');
  });

  it('clears the user so an event cannot inherit the last request', () => {
    // Sentry's requestHandler gives each request its own hub, but
    // background work runs on the root one. An event tagged with an
    // unrelated agent is worse than an untagged event, because it sends
    // whoever is triaging to the wrong tenant.
    sentry.reportBackgroundFailure('jobs', 'expireStaleOrders', new Error('x'));
    assert.equal(rec.calls[0].scope.user, null);
  });

  it('passes extra through to both the scope context and the event', () => {
    sentry.reportBackgroundFailure('stellar-watcher', 'dispatch_poison', new Error('x'), {
      tx_hash: 'abc',
      attempts: 3,
    });
    const call = rec.calls[0];
    assert.equal(call.options.extra.tx_hash, 'abc');
    assert.equal(call.options.extra.attempts, 3);
    assert.deepEqual(call.scope.contexts.background_work, {
      subsystem: 'stellar-watcher',
      operation: 'dispatch_poison',
      tx_hash: 'abc',
      attempts: 3,
    });
  });

  it('reports a non-Error throw without stringifying it first', () => {
    // Sub-jobs are ordinary async functions and can reject with anything.
    // Sentry knows how to render a non-Error; converting it here would
    // throw away whatever structure it had.
    sentry.reportBackgroundFailure('jobs', 'purgeOldCards', { code: 'EACCES' });
    assert.deepEqual(rec.calls[0].error, { code: 'EACCES' });
  });

  it('swallows a throw from inside the SDK', () => {
    // The contract every caller relies on: this runs in a catch block
    // that already decided the failure was survivable. Observability must
    // not be what takes the loop down.
    /** @type {any} */ const S = sentry.Sentry;
    const realWithScope = S.withScope;
    S.withScope = () => {
      throw new Error('transport is on fire');
    };
    try {
      assert.equal(sentry.reportBackgroundFailure('jobs', 'anything', new Error('x')), undefined);
    } finally {
      S.withScope = realWithScope;
    }
  });
});

describe('the job loop reports sub-job failures', () => {
  /** @type {ReturnType<typeof recordCaptures>} */ let rec;

  beforeEach(() => {
    if (rec) rec.restore();
    rec = recordCaptures();
    mock.method(console, 'error', () => {});
  });

  it('reports a throwing sub-job under its own name', async () => {
    // _runSubJob's isolating catch is what makes the loop survivable and
    // is also what made these failures invisible: a sub-job can throw on
    // every tick for weeks with nothing but a stderr line to show for it.
    const { _runSubJob } = require('../../src/jobs');
    const boom = new Error('webhook target unreachable');

    await _runSubJob('retryWebhooks', async () => {
      throw boom;
    });

    assert.equal(rec.calls.length, 1, 'exactly one event per failed sub-job');
    assert.equal(rec.calls[0].error, boom);
    assert.equal(rec.calls[0].scope.tags.subsystem, 'jobs');
    assert.equal(rec.calls[0].scope.tags.operation, 'retryWebhooks');
  });

  it('still swallows the failure so the rest of the chain runs', async () => {
    const { _runSubJob } = require('../../src/jobs');
    await assert.doesNotReject(
      _runSubJob('expireStaleOrders', async () => {
        throw new Error('boom');
      }),
    );
  });

  it('reports nothing when the sub-job succeeds', async () => {
    const { _runSubJob } = require('../../src/jobs');
    let ran = false;
    await _runSubJob('pruneIdempotencyKeys', async () => {
      ran = true;
    });
    assert.equal(ran, true);
    assert.equal(rec.calls.length, 0);
  });
});
