// Unit tests for src/lib/rpc-pool.js — the health-aware multi-endpoint
// RPC fallback pool with circuit breaking used by the payment-event
// watcher (src/payments/stellar.js).
//
// The network is mocked entirely: every "endpoint" is an in-memory fake
// whose getLatestLedger / getEvents either resolves or throws on
// command, and the pool's clock (`now`) + delay (`sleep`) are injected
// so circuit transitions happen deterministically with no real time.

require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createRpcServerPool, parseRpcUrls, _DEFAULTS } = require('../../src/lib/rpc-pool');

// ── Helpers ────────────────────────────────────────────────────────────────

// A fake rpc.Server. Records every method call and defers behaviour to
// the supplied handlers (throw → mocked network failure).
function fakeServer(handlers = {}) {
  return {
    calls: [],
    async getLatestLedger() {
      this.calls.push('getLatestLedger');
      if (handlers.getLatestLedger) return handlers.getLatestLedger();
      return { sequence: 4242 };
    },
    async getEvents(request) {
      this.calls.push(['getEvents', request]);
      if (handlers.getEvents) return handlers.getEvents(request);
      return { events: [], cursor: 'cur', latestLedger: 4242 };
    },
  };
}

function throwingServer(message) {
  const boom = () => {
    throw new Error(message);
  };
  return fakeServer({ getLatestLedger: boom, getEvents: boom });
}

// Build a pool over the given fake servers. Test defaults: no timers,
// no failover delay, frozen clock, and a silent logger.
function makePool(servers, opts = {}) {
  let i = 0;
  return createRpcServerPool({
    urls: servers.map((_, idx) => `https://rpc-${idx}.example.com`),
    serverFactory: () => servers[i++],
    autoProbe: false,
    failoverBackoffMs: 0,
    now: () => 0,
    sleep: async () => {},
    logger: { event: () => {}, log: () => {} },
    ...opts,
  });
}

const silentLogger = { event: () => {}, log: () => {} };

// ── parseRpcUrls ───────────────────────────────────────────────────────────

describe('parseRpcUrls', () => {
  it('splits, trims and de-duplicates a comma-separated list', () => {
    assert.deepEqual(
      parseRpcUrls(
        ' https://a.example.com , https://b.example.com ,https://a.example.com, ',
      ),
      ['https://a.example.com', 'https://b.example.com'],
    );
  });

  it('drops empty entries and non-http(s) schemes', () => {
    assert.deepEqual(
      parseRpcUrls('https://a.example.com,,ftp://b.example.com, javascript:alert(1)'),
      ['https://a.example.com'],
    );
  });

  it('accepts a single URL unchanged (backwards compatible)', () => {
    assert.deepEqual(parseRpcUrls('https://a.example.com'), ['https://a.example.com']);
  });

  it('returns [] for undefined / empty / non-string input', () => {
    assert.deepEqual(parseRpcUrls(undefined), []);
    assert.deepEqual(parseRpcUrls('   '), []);
    assert.deepEqual(parseRpcUrls(null), []);
    assert.deepEqual(parseRpcUrls(42), []);
  });
});

// ── Happy path ─────────────────────────────────────────────────────────────

describe('rpc pool — happy path', () => {
  it('routes getEvents to the endpoint and returns its result', async () => {
    const server = fakeServer({
      getEvents: () => ({ events: [{ id: 'e1' }], cursor: 'c1', latestLedger: 10 }),
    });
    const pool = makePool([server]);
    const request = { limit: 200 };

    const result = await pool.getEvents(request);

    assert.equal(result.cursor, 'c1');
    assert.equal(result.events[0].id, 'e1');
    assert.deepEqual(server.calls, [['getEvents', request]]);
    assert.equal(pool._state()[0].state, 'closed');
    assert.equal(pool._state()[0].consecutiveFailures, 0);
  });

  it('routes getLatestLedger through the pool', async () => {
    const server = fakeServer({ getLatestLedger: () => ({ sequence: 99 }) });
    const pool = makePool([server]);
    const result = await pool.getLatestLedger();
    assert.equal(result.sequence, 99);
    assert.deepEqual(server.calls, ['getLatestLedger']);
  });
});

// ── Transparent failover ───────────────────────────────────────────────────

describe('rpc pool — transparent endpoint failover', () => {
  it('fails over to the secondary endpoint when the primary throws', async () => {
    const primary = throwingServer('primary down');
    const secondary = fakeServer({
      getEvents: () => ({ events: [], cursor: 'c2', latestLedger: 5 }),
    });
    const pool = makePool([primary, secondary]);

    const result = await pool.getEvents({ limit: 200 });

    // Caller sees a normal, successful result — the failover is invisible.
    assert.equal(result.cursor, 'c2');
    assert.equal(primary.calls.length, 1);
    assert.equal(secondary.calls.length, 1);
    // Primary counted the failure; secondary is still healthy.
    assert.equal(pool._state()[0].consecutiveFailures, 1);
    assert.equal(pool._state()[1].consecutiveFailures, 0);
  });

  it('applies exponential backoff between failover attempts', async () => {
    const delays = [];
    const servers = [throwingServer('a'), throwingServer('b'), fakeServer()];
    let k = 0;
    const pool = createRpcServerPool({
      urls: ['https://a.example.com', 'https://b.example.com', 'https://c.example.com'],
      serverFactory: () => servers[k++],
      autoProbe: false,
      failoverBackoffMs: 100,
      now: () => 0,
      sleep: async (ms) => {
        delays.push(ms);
      },
      logger: silentLogger,
    });

    const result = await pool.getLatestLedger();

    assert.equal(result.sequence, 4242);
    // attempt 1 → no delay; attempt 2 → 100ms; attempt 3 → 200ms.
    assert.deepEqual(delays, [100, 200]);
  });

  it('throws the last error when every healthy endpoint fails', async () => {
    const a = throwingServer('a down');
    const b = throwingServer('b down');
    const pool = makePool([a, b]);
    await assert.rejects(pool.getLatestLedger(), /b down/);
    assert.equal(pool._state()[0].consecutiveFailures, 1);
    assert.equal(pool._state()[1].consecutiveFailures, 1);
  });
});

// ── Circuit breaking ───────────────────────────────────────────────────────

describe('rpc pool — circuit breaking', () => {
  it('trips the circuit after 3 consecutive failures and then skips the endpoint', async () => {
    const primary = throwingServer('boom');
    const secondary = fakeServer();
    const pool = makePool([primary, secondary]);

    for (let i = 1; i <= 3; i++) {
      await pool.getEvents({ limit: 200 });
      assert.equal(pool._state()[0].consecutiveFailures, i);
      assert.equal(pool._state()[0].state, i < 3 ? 'closed' : 'open');
    }

    const callsWhenTripped = primary.calls.length;
    // The next request must not touch the tripped endpoint at all.
    await pool.getEvents({ limit: 200 });
    assert.equal(primary.calls.length, callsWhenTripped);
  });

  it('resets the consecutive-failure counter on a success', async () => {
    let fail = true;
    const flaky = fakeServer({
      getEvents: () => {
        if (fail) throw new Error('flaky');
        return { events: [] };
      },
    });
    const pool = makePool([flaky]);

    await assert.rejects(pool.getEvents({}), /flaky/);
    await assert.rejects(pool.getEvents({}), /flaky/);
    assert.equal(pool._state()[0].consecutiveFailures, 2);

    fail = false;
    await pool.getEvents({});
    assert.equal(pool._state()[0].consecutiveFailures, 0);
    assert.equal(pool._state()[0].state, 'closed');
  });

  it('throws immediately once every endpoint is tripped', async () => {
    const a = throwingServer('a down');
    const b = throwingServer('b down');
    let t = 0;
    const pool = createRpcServerPool({
      urls: ['https://a.example.com', 'https://b.example.com'],
      serverFactory: (() => {
        const list = [a, b];
        let k = 0;
        return () => list[k++];
      })(),
      autoProbe: false,
      baseProbeDelayMs: 10_000,
      failoverBackoffMs: 0,
      now: () => t,
      sleep: async () => {},
      logger: silentLogger,
    });

    for (let i = 0; i < 3; i++) {
      await assert.rejects(pool.getLatestLedger(), /[ab] down/);
    }
    assert.ok(pool._state().every((e) => e.state === 'open'));

    // No healthy endpoint and no probe due (clock frozen at 0) → fail fast.
    await assert.rejects(pool.getLatestLedger(), /all 2 endpoint\(s\) tripped/);
    // …and t is never advanced, so the tripped endpoints are never hit again.
    assert.equal(a.calls.length, 3);
    assert.equal(b.calls.length, 3);
  });
});

// ── Periodic probing / recovery ────────────────────────────────────────────

describe('rpc pool — periodic probing and recovery', () => {
  function trippedPool() {
    let health = 'down';
    const clock = { t: 0 };
    const server = fakeServer({
      getLatestLedger: () => {
        if (health === 'down') throw new Error('unavailable');
        return { sequence: 7 };
      },
    });
    const pool = createRpcServerPool({
      urls: ['https://a.example.com'],
      serverFactory: () => server,
      autoProbe: false,
      baseProbeDelayMs: 1000,
      maxProbeDelayMs: 8000,
      now: () => clock.t,
      sleep: async () => {},
      logger: silentLogger,
    });
    return { pool, server, clock, setHealth: (h) => (health = h) };
  }

  it('recovers a tripped endpoint once a due probe succeeds', async () => {
    const { pool, clock, setHealth } = trippedPool();
    for (let i = 0; i < 3; i++) await assert.rejects(pool.getLatestLedger(), /unavailable/);
    assert.equal(pool._state()[0].state, 'open');

    // Probe window hasn't elapsed yet → nothing probed.
    assert.equal(await pool.probeDueEndpoints(), 0);
    assert.equal(pool._state()[0].state, 'open');

    // Advance past the probe delay and restore the endpoint.
    clock.t = 1000;
    setHealth('up');
    assert.equal(await pool.probeDueEndpoints(), 1);
    assert.equal(pool._state()[0].state, 'closed');
    assert.equal(pool._state()[0].consecutiveFailures, 0);

    // Real traffic flows again through the recovered endpoint.
    const result = await pool.getLatestLedger();
    assert.equal(result.sequence, 7);
  });

  it('grows the probe interval exponentially while the endpoint stays down', async () => {
    const { pool, clock } = trippedPool();
    for (let i = 0; i < 3; i++) await assert.rejects(pool.getLatestLedger(), /unavailable/);
    assert.equal(pool._state()[0].nextProbeAt, 1000); // base * 2^0

    clock.t = 1000;
    assert.equal(await pool.probeDueEndpoints(), 1);
    assert.equal(pool._state()[0].probeAttempts, 1);
    assert.equal(pool._state()[0].nextProbeAt, 1000 + 2000); // base * 2^1

    clock.t = 3000;
    assert.equal(await pool.probeDueEndpoints(), 1);
    assert.equal(pool._state()[0].nextProbeAt, 3000 + 4000); // base * 2^2

    // Capped at maxProbeDelayMs (8000) rather than growing unbounded.
    clock.t = 7000;
    assert.equal(await pool.probeDueEndpoints(), 1); // nextProbeAt = 7000 + 8000
    clock.t = 15_000;
    assert.equal(await pool.probeDueEndpoints(), 1); // nextProbeAt = 15000 + 8000
    assert.equal(pool._state()[0].nextProbeAt, 15_000 + 8000);
  });

  it('does not probe an endpoint before its scheduled time', async () => {
    const { pool } = trippedPool();
    for (let i = 0; i < 3; i++) await assert.rejects(pool.getLatestLedger(), /unavailable/);
    // now() is 0, the first probe is due at 1000 → no probe, no state change.
    assert.equal(await pool.probeDueEndpoints(), 0);
    assert.equal(pool._state()[0].probeAttempts, 0);
    assert.equal(pool._state()[0].state, 'open');
  });

  it('does nothing when no endpoint is tripped', async () => {
    const server = fakeServer();
    const pool = makePool([server]);
    assert.equal(await pool.probeDueEndpoints(), 0);
    assert.equal(server.calls.length, 0);
  });
});

// ── Construction guards + defaults ─────────────────────────────────────────

describe('rpc pool — construction and defaults', () => {
  it('rejects an empty URL list', () => {
    assert.throws(
      () => createRpcServerPool({ urls: [], serverFactory: () => fakeServer() }),
      /at least one RPC URL/,
    );
  });

  it('rejects a missing serverFactory', () => {
    assert.throws(
      () => createRpcServerPool({ urls: ['https://a.example.com'] }),
      /serverFactory/,
    );
  });

  it('exposes the documented defaults (failure threshold trips at 3)', () => {
    assert.equal(_DEFAULTS.DEFAULT_FAILURE_THRESHOLD, 3);
    assert.ok(_DEFAULTS.DEFAULT_BASE_PROBE_DELAY_MS > 0);
    assert.ok(_DEFAULTS.DEFAULT_MAX_PROBE_DELAY_MS >= _DEFAULTS.DEFAULT_BASE_PROBE_DELAY_MS);
  });
});
