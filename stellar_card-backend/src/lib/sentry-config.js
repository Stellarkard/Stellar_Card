// @ts-check
// Sentry error tracking — initialisation, PII scrubbing, and the Express
// middleware pair.
//
// Design notes, because a few choices here are deliberate and look odd
// without the reasoning:
//
//   1. Everything is gated on "did init actually succeed", not on
//      NODE_ENV. An earlier revision gated every export on
//      `NODE_ENV === 'production'`, which meant captureException() was a
//      hard no-op anywhere else — including in the test suite, so none of
//      the scrubbing logic below could be exercised at all. It also meant
//      a developer pointing SENTRY_DSN at a scratch project to reproduce
//      an issue locally got silence. `initialized` is the single source
//      of truth: no DSN, a malformed DSN, or an init failure all leave
//      every export as a cheap no-op, and every call site can stay
//      unconditional.
//
//   2. Sentry's own OnUncaughtException / OnUnhandledRejection
//      integrations are removed. src/index.js already owns both signals:
//      it logs a structured bizEvent and runs the graceful-shutdown path
//      (drain the Soroban watcher, cancel jobs, close the HTTP server).
//      Sentry's uncaught-exception integration calls process.exit() on a
//      fatal error by default, which would kill in-flight orders before
//      that drain completes. index.js reports to Sentry explicitly
//      instead, so we get the event AND the clean shutdown.
//
//   3. The DSN is shape-validated before it reaches Sentry.init(). A
//      malformed DSN makes Sentry.init() throw, and since initSentry()
//      runs as the first statement in the entrypoint that throw would
//      take down the whole process — turning a typo in an *optional*
//      observability variable into a total outage. A bad DSN now logs
//      loudly and leaves Sentry disabled.
//
//   4. Profiling is opt-in and its native module is loaded optionally.
//      @sentry/profiling-node is a native addon that is not a declared
//      dependency of this package; requiring it unconditionally at module
//      load threw MODULE_NOT_FOUND for every consumer of this file.

const Sentry = require('@sentry/node');

// A Sentry DSN looks like https://<publicKey>@<host>/<projectId>, with an
// optional legacy :<secretKey> after the public key. Anything else is a
// copy-paste error (a full project URL, a truncated value, a quoted
// string that kept its quotes).
const DSN_SHAPE = /^https?:\/\/[^:@/\s]+(:[^@/\s]+)?@[^/\s]+\/\d+$/;

// Header names that must never leave the process. Lower-cased for
// comparison; Sentry normalises header keys but we defensively check
// both cases.
const REDACTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-vcc-signature',
  'x-signature',
  'idempotency-key',
  'proxy-authorization',
]);

// Field names whose values are secrets or cardholder data. Matched
// case-insensitively against object keys at any depth of `extra`,
// `contexts`, and breadcrumb data.
const REDACTED_FIELDS = [
  'card_number',
  'cardnumber',
  'card_cvv',
  'cvv',
  'cvc',
  'pan',
  'card_expiry',
  'api_key',
  'apikey',
  'webhook_secret',
  'callback_secret',
  'sealed_payload',
  'secret',
  'password',
  'token',
  'code_hash',
  'key_hash',
];

const REDACTED = '[redacted]';

/** @type {boolean} */
let initialized = false;
/** @type {boolean} */
let warnedAboutProfiling = false;

/** True once Sentry has been successfully initialised. */
function isEnabled() {
  return initialized;
}

/**
 * Recursively replace the values of sensitive keys with a redaction
 * marker. Returns a new object; the input is not mutated, because Sentry
 * hands us live references to objects the caller may still be using.
 *
 * Depth-bounded: a hostile or accidentally-circular payload must not be
 * able to blow the stack inside beforeSend, which runs on the hot path
 * of every captured error.
 *
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
function redactDeep(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (REDACTED_FIELDS.some((f) => lower === f || lower.endsWith(`_${f}`))) {
      out[key] = REDACTED;
    } else {
      out[key] = redactDeep(val, depth + 1);
    }
  }
  return out;
}

/**
 * Strip credentials and cardholder data out of an event before it is
 * transmitted.
 *
 * Exported (as `_scrubEvent`) so the scrubbing rules can be unit-tested
 * directly rather than through a live Sentry transport.
 *
 * @param {any} event
 * @returns {any} the same event object, mutated in place (Sentry's
 *   beforeSend contract expects the event back)
 */
function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (event.request) {
    const req = event.request;

    if (req.headers && typeof req.headers === 'object') {
      for (const name of Object.keys(req.headers)) {
        if (REDACTED_HEADERS.has(name.toLowerCase())) {
          req.headers[name] = REDACTED;
        }
      }
    }

    // Request bodies on this API carry claim codes, login codes, and
    // webhook payloads. None of it is needed to triage an error and all
    // of it is sensitive, so it is dropped wholesale rather than
    // field-filtered.
    if (req.data !== undefined) req.data = REDACTED;

    // Query strings can carry an api key on misconfigured clients.
    if (req.query_string) req.query_string = REDACTED;

    if (req.cookies) req.cookies = REDACTED;

    // The URL may embed a claim code or receipt id path segment; keep
    // the path (needed for triage) but drop any query component.
    if (typeof req.url === 'string') {
      const q = req.url.indexOf('?');
      if (q !== -1) req.url = `${req.url.slice(0, q)}?${REDACTED}`;
    }
  }

  if (event.extra) event.extra = redactDeep(event.extra);
  if (event.contexts) event.contexts = redactDeep(event.contexts);

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) =>
      crumb && crumb.data ? { ...crumb, data: redactDeep(crumb.data) } : crumb,
    );
  }

  return event;
}

/**
 * Load the optional profiling integration.
 *
 * @sentry/profiling-node is a native addon and is not a declared
 * dependency, so it is loaded defensively: if profiling is off (the
 * default) we never touch it, and if it is on but the module is absent
 * we warn once and continue without profiling rather than refusing to
 * boot.
 *
 * @param {number} profilesSampleRate
 * @returns {any[]} zero or one integration
 */
function optionalProfilingIntegration(profilesSampleRate) {
  if (profilesSampleRate <= 0) return [];
  try {
    // Resolved through a variable so neither the type checker nor a
    // bundler treats this optional native addon as a hard dependency —
    // it is intentionally absent from package.json.
    const moduleName = '@sentry/profiling-node';
    const { nodeProfilingIntegration } = require(moduleName);
    return [nodeProfilingIntegration()];
  } catch {
    if (!warnedAboutProfiling) {
      warnedAboutProfiling = true;
      console.warn(
        '[sentry] SENTRY_PROFILES_SAMPLE_RATE is set but @sentry/profiling-node is not ' +
          'installed — continuing without profiling. Run `npm install @sentry/profiling-node` ' +
          'to enable it.',
      );
    }
    return [];
  }
}

/**
 * Parse a sample rate env var, clamped to [0, 1].
 *
 * An out-of-range or non-numeric value falls back to the default rather
 * than throwing — a typo in a sampling knob should never stop the
 * process from booting.
 *
 * @param {string|undefined} raw
 * @param {number} fallback
 * @returns {number}
 */
function sampleRate(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    console.warn(
      `[sentry] ignoring out-of-range sample rate ${JSON.stringify(raw)} — using ${fallback}`,
    );
    return fallback;
  }
  return n;
}

/**
 * Build the options object handed to Sentry.init().
 *
 * Split out from initSentry() so the configuration can be asserted in
 * tests without standing up a live client and transport.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, any>}
 */
function buildSentryOptions(env = process.env) {
  const profilesSampleRate = sampleRate(env.SENTRY_PROFILES_SAMPLE_RATE, 0);
  return {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
    release: env.SENTRY_RELEASE || undefined,
    tracesSampleRate: sampleRate(env.SENTRY_TRACES_SAMPLE_RATE, 0.1),
    profilesSampleRate,
    sendDefaultPii: false,
    attachStacktrace: true,
    // See note 2 at the top of the file: index.js owns the process-level
    // signals so the graceful-shutdown path is not short-circuited by
    // Sentry's own exit-on-fatal behaviour.
    integrations: (/** @type {any[]} */ defaults) => [
      ...defaults.filter(
        (integration) =>
          integration.name !== 'OnUncaughtException' && integration.name !== 'OnUnhandledRejection',
      ),
      ...optionalProfilingIntegration(profilesSampleRate),
    ],
    ignoreErrors: ['NetworkError: Failed to fetch', 'NotSupportedError', 'AbortError'],
    beforeSend: (/** @type {any} */ event) => scrubEvent(event),
    beforeBreadcrumb: (/** @type {any} */ crumb) =>
      crumb && crumb.data ? { ...crumb, data: redactDeep(crumb.data) } : crumb,
  };
}

/**
 * Initialise Sentry. Safe to call more than once — subsequent calls are
 * no-ops.
 *
 * Must run before any other module is required so the SDK's
 * auto-instrumentation can patch http/express before they are used.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} whether error tracking is now active
 */
function initSentry(env = process.env) {
  if (initialized) return true;

  const dsn = (env.SENTRY_DSN || '').trim();

  if (!dsn) {
    // Not an error: Sentry is optional. Say so once in production, where
    // running without error tracking is a decision worth surfacing, and
    // stay quiet in dev/test where it is the norm.
    if (env.NODE_ENV === 'production') {
      console.warn('[sentry] SENTRY_DSN not configured — error tracking is disabled');
    }
    return false;
  }

  if (!DSN_SHAPE.test(dsn)) {
    console.error(
      '[sentry] SENTRY_DSN is malformed — expected https://<publicKey>@<host>/<projectId>. ' +
        'Error tracking is disabled; the process will continue.',
    );
    return false;
  }

  try {
    Sentry.init(buildSentryOptions({ ...env, SENTRY_DSN: dsn }));
    initialized = true;
  } catch (err) {
    console.error(
      `[sentry] initialisation failed: ${err instanceof Error ? err.message : String(err)} — ` +
        'error tracking is disabled; the process will continue.',
    );
    return false;
  }

  // Log the host and project id only. The public key is not a secret in
  // the strict sense (it ships in browser bundles) but it is a write
  // credential for the project, and log aggregators are a wider audience
  // than the deploy environment.
  const projectRef = dsn.slice(dsn.indexOf('@') + 1);
  console.log(
    `[sentry] error tracking active (project=${projectRef}, env=${
      env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development'
    })`,
  );
  return true;
}

/**
 * Report an exception.
 *
 * @param {unknown} error
 * @param {{ tags?: Record<string, string>, extra?: Record<string, unknown>,
 *           level?: 'fatal'|'error'|'warning'|'info'|'debug' }} [context]
 * @returns {string|undefined} the Sentry event id, if one was created
 */
function captureException(error, context = {}) {
  if (!initialized) return undefined;
  return Sentry.captureException(error, {
    tags: context.tags,
    extra: context.extra,
    level: context.level,
  });
}

/**
 * Report a message.
 *
 * @param {string} message
 * @param {'fatal'|'error'|'warning'|'info'|'debug'} [level]
 * @param {{ tags?: Record<string, string>, extra?: Record<string, unknown> }} [context]
 * @returns {string|undefined} the Sentry event id, if one was created
 */
function captureMessage(message, level = 'info', context = {}) {
  if (!initialized) return undefined;
  return Sentry.captureMessage(message, {
    level,
    tags: context.tags,
    extra: context.extra,
  });
}

/**
 * Report a failure from work that has no request behind it.
 *
 * Everything wired before this reported from the request path: the
 * Express error handler, the process-level handlers, and the
 * error-level log mirror. Background work reported to stderr and a
 * bizEvent only — which inverts the priority. A failed request has a
 * client who notices; a wedged sub-job, a dead Soroban watcher, or an
 * alert evaluator that stopped evaluating is silent until an order
 * quietly does not get fulfilled.
 *
 * Two things this does that a bare captureException() would not:
 *
 *   1. It runs inside `withScope`, so the event cannot inherit whatever
 *      the last HTTP request left on the hub. Sentry's requestHandler
 *      gives each request its own hub, but background work runs on the
 *      root one — an event tagged with an unrelated request_id or user
 *      is worse than an untagged one, because it sends whoever is
 *      triaging to the wrong place.
 *   2. It tags `subsystem` and `operation`. Background failures have no
 *      transaction name to group by, so without them every job failure
 *      lands in one undifferentiated bucket and Sentry's "issues" view
 *      cannot tell "the webhook retry loop is broken" from "the pruner
 *      is broken".
 *
 * Never throws and needs no `isEnabled()` guard at the call site, in
 * keeping with captureException/captureMessage.
 *
 * @param {string} subsystem coarse owner, e.g. 'jobs' or 'stellar-watcher'
 * @param {string} operation the specific unit of work that failed
 * @param {unknown} error
 * @param {Record<string, unknown>} [extra]
 * @returns {string|undefined} the Sentry event id, if one was created
 */
function reportBackgroundFailure(subsystem, operation, error, extra = {}) {
  if (!initialized) return undefined;
  try {
    return Sentry.withScope((scope) => {
      scope.setUser(null);
      scope.setTag('subsystem', subsystem);
      scope.setTag('operation', operation);
      scope.setContext('background_work', { subsystem, operation, ...extra });
      return Sentry.captureException(error, { extra, level: 'error' });
    });
  } catch {
    // Observability must never take down the loop it is observing —
    // the whole point of this call site is that the caller already
    // decided the failure was survivable.
    return undefined;
  }
}

/**
 * Attach the request correlation id to the active scope so a Sentry
 * event can be joined against the structured logs for the same request.
 *
 * @param {string} requestId
 */
function setRequestId(requestId) {
  if (!initialized || !requestId) return;
  Sentry.getCurrentHub().configureScope((scope) => scope.setTag('request_id', requestId));
}

/**
 * Identify the acting principal on the current scope. Only the opaque
 * api key / user id is sent — never the email, which is PII we have no
 * need for in a stack trace.
 *
 * @param {string} userId
 * @param {Record<string, unknown>} [metadata]
 */
function setUserContext(userId, metadata = {}) {
  if (!initialized) return;
  Sentry.setUser({ id: userId, ...metadata });
}

/** Clear the identified principal from the current scope. */
function clearUserContext() {
  if (!initialized) return;
  Sentry.setUser(null);
}

/**
 * Flush buffered events. Called from the graceful-shutdown path so a
 * crash report is not lost when the process exits moments later.
 *
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>} true if the queue drained within the timeout
 */
async function flush(timeoutMs = 2000) {
  if (!initialized) return true;
  try {
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}

/**
 * Express request handler. Establishes the per-request Sentry scope.
 * Mount before any route.
 *
 * @returns {import('express').RequestHandler}
 */
function sentryRequestHandler() {
  if (!initialized) return (_req, _res, next) => next();
  return Sentry.Handlers.requestHandler();
}

/**
 * Decide whether an Express error is worth reporting.
 *
 * Sentry's default predicate captures anything without a numeric status,
 * which would include the CORS rejection app.js raises for a disallowed
 * origin. That is a client mistake, it arrives at whatever rate the open
 * internet decides, and it would bury real 500s in noise. Same for any
 * error carrying a 4xx status: by definition the caller got a useful
 * response and there is nothing for an engineer to fix.
 *
 * Errors with no status at all ARE reported — an unexpected throw out of
 * a route handler is exactly the case this integration exists for.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function shouldReportError(error) {
  const message = /** @type {any} */ (error)?.message;
  if (typeof message === 'string' && message.startsWith('CORS:')) return false;
  const raw = /** @type {any} */ (error)?.status ?? /** @type {any} */ (error)?.statusCode;
  const status = Number(raw);
  if (raw !== undefined && raw !== null && Number.isFinite(status) && status < 500) return false;
  return true;
}

/**
 * Express error handler. Mount after every route but before the
 * application's own error responder, which terminates the chain.
 *
 * @returns {import('express').ErrorRequestHandler}
 */
function sentryErrorHandler() {
  if (!initialized) return (err, _req, _res, next) => next(err);
  return Sentry.Handlers.errorHandler({ shouldHandleError: shouldReportError });
}

module.exports = {
  Sentry,
  initSentry,
  isEnabled,
  captureException,
  captureMessage,
  reportBackgroundFailure,
  setRequestId,
  setUserContext,
  clearUserContext,
  flush,
  sentryRequestHandler,
  sentryErrorHandler,
  // Internal — exported so the scrubbing rules and option construction
  // can be unit-tested without a live transport. Not part of the module's
  // public surface.
  _scrubEvent: scrubEvent,
  _redactDeep: redactDeep,
  _shouldReportError: shouldReportError,
  _buildSentryOptions: buildSentryOptions,
  _DSN_SHAPE: DSN_SHAPE,
};
