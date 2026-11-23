// @ts-check
// Health-aware multi-endpoint JSON-RPC fallback pool with circuit breaking.
//
// Why this exists
// ───────────────
// The payment-event watcher in src/payments/stellar.js polls a single
// Soroban/Horizon RPC endpoint. When that endpoint has an incident the
// watcher logs `stellar.poll_error` and retries the SAME endpoint forever,
// so on-chain payments are silently missed for the duration of the outage.
//
// This module wraps N endpoints behind one small API and keeps ingestion
// alive transparently:
//
//   * Fail a request over to the next healthy endpoint.
//   * Track consecutive failures per endpoint and trip (open) its circuit
//     after `failureThreshold` (default 3) consecutive failures, so a
//     known-bad endpoint isn't hammered.
//   * Back off exponentially between failover attempts.
//   * Periodically probe tripped endpoints on a growing interval and close
//     the circuit again as soon as the endpoint recovers.
//
// The pool duck-types the two @stellar/stellar-sdk `rpc.Server` methods the
// watcher uses (`getLatestLedger`, `getEvents`), so the watcher keeps
// calling `rpcServer.getEvents(request)` exactly as before.
//
// Design notes
// ────────────
//   * Deterministic and dependency-free: the clock (`now`) and the delay
//     function (`sleep`) are injectable, so unit tests exercise circuit
//     transitions without real time passing or touching the network.
//   * Timers are opt-in for tests: `autoProbe` (default true) starts an
//     `.unref()`'d interval that recovers tripped endpoints. Tests pass
//     `autoProbe: false` and drive probing explicitly via
//     `probeDueEndpoints()`.

'use strict';

const { event: bizEvent } = require('./logger');

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_BASE_PROBE_DELAY_MS = 1000;
const DEFAULT_MAX_PROBE_DELAY_MS = 60_000;
const DEFAULT_FAILOVER_BACKOFF_MS = 100;
const DEFAULT_MAX_FAILOVER_BACKOFF_MS = 5_000;
const DEFAULT_PROBE_INTERVAL_MS = 5_000;

/**
 * Split a comma-separated RPC URL list into a clean array.
 *
 * Trims each entry, drops empty entries (e.g. from a trailing comma),
 * drops anything that isn't `http(s)://`, and de-duplicates while
 * preserving order. A single URL (no comma) round-trips unchanged, so
 * the legacy single-endpoint config keeps working.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
function parseRpcUrls(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  const seen = new Set();
  const urls = [];
  for (const part of raw.split(',')) {
    const url = part.trim();
    if (!url) continue;
    // Reject non-http(s) schemes (ftp://, file://, javascript:, …) the
    // same way src/env.js does at boot — defence in depth so a caller
    // that bypasses env validation still can't hand us a bogus endpoint.
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

/**
 * Default delay implementation. Kept separate so tests can inject a
 * no-op and keep the suite fast.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a health-aware fallback pool over one or more RPC endpoints.
 *
 * @param {{
 *   urls: string[],
 *   serverFactory: (url: string) => any,
 *   probe?: (server: any) => Promise<any>,
 *   failureThreshold?: number,
 *   baseProbeDelayMs?: number,
 *   maxProbeDelayMs?: number,
 *   failoverBackoffMs?: number,
 *   maxFailoverBackoffMs?: number,
 *   autoProbe?: boolean,
 *   probeIntervalMs?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   logger?: { event?: (name: string, fields?: Record<string, unknown>) => void, log?: (msg: string) => void },
 * }} options
 */
function createRpcServerPool(options = {}) {
  const {
    urls,
    serverFactory,
    probe,
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
    baseProbeDelayMs = DEFAULT_BASE_PROBE_DELAY_MS,
    maxProbeDelayMs = DEFAULT_MAX_PROBE_DELAY_MS,
    failoverBackoffMs = DEFAULT_FAILOVER_BACKOFF_MS,
    maxFailoverBackoffMs = DEFAULT_MAX_FAILOVER_BACKOFF_MS,
    autoProbe = true,
    probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
    now = () => Date.now(),
    sleep = defaultSleep,
    logger = { event: bizEvent, log: console.log },
  } = options;

  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('createRpcServerPool: at least one RPC URL is required');
  }
  if (typeof serverFactory !== 'function') {
    throw new Error('createRpcServerPool: serverFactory must be a function');
  }

  const emit = typeof logger.event === 'function' ? logger.event : () => {};
  const say = typeof logger.log === 'function' ? logger.log : () => {};
  // Default probe: the lightest possible round trip against the endpoint.
  const probeFn = typeof probe === 'function' ? probe : (server) => server.getLatestLedger();

  // One record per endpoint. `state` is the circuit state:
  //   'closed' — healthy / eligible to serve traffic
  //   'open'   — tripped / skipped until a probe succeeds
  const endpoints = urls.map((url, index) => ({
    url,
    index,
    server: serverFactory(url),
    state: 'closed',
    consecutiveFailures: 0,
    openedAt: null,
    nextProbeAt: 0,
    probeAttempts: 0,
    probeInFlight: false,
  }));

  // Exponential probe delay (capped): base * 2^attempt.
  function probeDelay(attempt) {
    const raw = baseProbeDelayMs * Math.pow(2, attempt);
    if (!Number.isFinite(raw)) return maxProbeDelayMs;
    return Math.min(raw, maxProbeDelayMs);
  }

  // Exponential failover delay (capped): base * 2^(attemptIndex - 1).
  function failoverDelay(attemptIndex) {
    const raw = failoverBackoffMs * Math.pow(2, attemptIndex - 1);
    if (!Number.isFinite(raw)) return maxFailoverBackoffMs;
    return Math.min(raw, maxFailoverBackoffMs);
  }

  function openCircuit(ep, reason) {
    ep.state = 'open';
    ep.openedAt = now();
    ep.probeAttempts = 0;
    ep.nextProbeAt = ep.openedAt + probeDelay(0);
    emit('stellar.rpc_endpoint_tripped', {
      url: ep.url,
      failures: ep.consecutiveFailures,
      reason: reason || null,
    });
    say(
      `[rpc-pool] circuit OPEN for ${ep.url} after ${ep.consecutiveFailures} consecutive failures ` +
        `(${reason || 'unknown'}) — probing again in ${probeDelay(0)}ms`,
    );
  }

  function closeCircuit(ep) {
    const wasOpen = ep.state === 'open';
    ep.state = 'closed';
    ep.consecutiveFailures = 0;
    ep.openedAt = null;
    ep.nextProbeAt = 0;
    ep.probeAttempts = 0;
    if (wasOpen) {
      emit('stellar.rpc_endpoint_recovered', { url: ep.url });
      say(`[rpc-pool] circuit CLOSED for ${ep.url} — endpoint recovered`);
    }
  }

  function recordSuccess(ep) {
    // A successful probe of an open endpoint closes its circuit. A
    // success on a closed endpoint simply resets the failure streak.
    if (ep.state === 'open') closeCircuit(ep);
    else ep.consecutiveFailures = 0;
  }

  function recordFailure(ep, reason) {
    ep.consecutiveFailures += 1;
    if (ep.state === 'closed' && ep.consecutiveFailures >= failureThreshold) {
      openCircuit(ep, reason);
    }
  }

  function healthyEndpoints() {
    return endpoints.filter((ep) => ep.state === 'closed');
  }

  /**
   * Invoke `method` on the first healthy endpoint that responds. Fall
   * over to the next healthy endpoint on failure, with exponential
   * backoff between attempts. Throws the last error if every healthy
   * endpoint fails; throws immediately if none are healthy.
   * @param {string} method
   * @param {unknown[]} args
   */
  async function dispatch(method, args) {
    const candidates = healthyEndpoints();
    if (candidates.length === 0) {
      emit('stellar.rpc_pool_exhausted', { endpoints: endpoints.length });
      throw new Error(
        `rpc-pool: all ${endpoints.length} endpoint(s) tripped ` +
          `(${endpoints.map((e) => e.url).join(', ')}); awaiting health probe`,
      );
    }

    let lastErr;
    for (let i = 0; i < candidates.length; i++) {
      const ep = candidates[i];
      if (i > 0) {
        const delay = failoverDelay(i);
        if (delay > 0) await sleep(delay);
      }
      try {
        // Property access preserves `this` binding on the SDK server.
        const result = await ep.server[method](...args);
        recordSuccess(ep);
        return result;
      } catch (err) {
        const reason = err && /** @type {Error} */ (err).message;
        recordFailure(ep, reason);
        lastErr = err;
        say(`[rpc-pool] ${ep.url} ${method} failed: ${reason || err}`);
      }
    }
    throw lastErr;
  }

  /**
   * Probe every open endpoint whose backoff window has elapsed. A
   * successful probe closes the circuit; a failed probe grows the next
   * probe interval exponentially (capped at maxProbeDelayMs).
   * @returns {Promise<number>} how many endpoints were probed
   */
  async function probeDueEndpoints() {
    const t = now();
    const due = endpoints.filter(
      (ep) => ep.state === 'open' && !ep.probeInFlight && t >= ep.nextProbeAt,
    );
    for (const ep of due) {
      ep.probeInFlight = true;
      try {
        await probeFn(ep.server);
        closeCircuit(ep);
      } catch (err) {
        ep.probeAttempts += 1;
        const nextDelay = probeDelay(ep.probeAttempts);
        ep.nextProbeAt = now() + nextDelay;
        const reason = err && /** @type {Error} */ (err).message;
        say(
          `[rpc-pool] probe of ${ep.url} failed (attempt ${ep.probeAttempts}), ` +
            `next probe in ${nextDelay}ms: ${reason || err}`,
        );
      } finally {
        ep.probeInFlight = false;
      }
    }
    return due.length;
  }

  /** @type {ReturnType<typeof setInterval> | null} */
  let probeTimer = null;

  function startAutoProbe() {
    if (probeTimer || !autoProbe) return;
    probeTimer = setInterval(() => {
      // Probe failures are handled inside probeDueEndpoints; swallow any
      // unexpected rejection so the interval can never become an
      // unhandled rejection that crashes the process.
      probeDueEndpoints().catch(() => {});
    }, probeIntervalMs);
    // Never keep the event loop alive just for health probes.
    if (typeof probeTimer.unref === 'function') probeTimer.unref();
  }

  function stopAutoProbe() {
    if (probeTimer) {
      clearInterval(probeTimer);
      probeTimer = null;
    }
  }

  if (autoProbe) startAutoProbe();

  return {
    // rpc.Server-compatible surface used by the watcher.
    getLatestLedger: () => dispatch('getLatestLedger', []),
    getEvents: (request) => dispatch('getEvents', [request]),
    // Generic escape hatch (kept so new server methods need no changes).
    dispatch,
    probeDueEndpoints,
    startAutoProbe,
    stopAutoProbe,
    // Test introspection — mirrors the `_`-prefixed hooks used elsewhere.
    _state: () =>
      endpoints.map((ep) => ({
        url: ep.url,
        state: ep.state,
        consecutiveFailures: ep.consecutiveFailures,
        openedAt: ep.openedAt,
        nextProbeAt: ep.nextProbeAt,
        probeAttempts: ep.probeAttempts,
      })),
    _reset: () => {
      for (const ep of endpoints) {
        ep.state = 'closed';
        ep.consecutiveFailures = 0;
        ep.openedAt = null;
        ep.nextProbeAt = 0;
        ep.probeAttempts = 0;
        ep.probeInFlight = false;
      }
    },
  };
}

module.exports = {
  createRpcServerPool,
  parseRpcUrls,
  _DEFAULTS: {
    DEFAULT_FAILURE_THRESHOLD,
    DEFAULT_BASE_PROBE_DELAY_MS,
    DEFAULT_MAX_PROBE_DELAY_MS,
    DEFAULT_FAILOVER_BACKOFF_MS,
    DEFAULT_MAX_FAILOVER_BACKOFF_MS,
    DEFAULT_PROBE_INTERVAL_MS,
  },
};
