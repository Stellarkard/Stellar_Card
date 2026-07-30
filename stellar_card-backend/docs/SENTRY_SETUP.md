# Sentry Error Tracking Setup Guide

## Overview

Sentry is an error tracking and performance monitoring service that helps identify, triage, and resolve production issues in real-time. This guide explains how Sentry is wired into the Stellar_Card backend and how to configure it.

Sentry is **optional**. With no `SENTRY_DSN` set, every Sentry call site in the codebase becomes a cheap no-op and the process boots and runs exactly as it did before. Nothing about the API's behaviour depends on error tracking being available.

## Features

- **Real-time error tracking**: Uncaught exceptions, unhandled rejections, and Express 5xx faults
- **Background coverage**: Job-loop, alert-evaluator and Soroban-watcher failures, tagged by subsystem and operation
- **Actor attribution**: Every authenticated `/v1` event carries the acting api key id and its tenant
- **Performance monitoring**: Sampled transaction traces
- **Profiling**: Opt-in CPU profiling via an optional native addon
- **Request correlation**: Every event is tagged with the same `request_id` the structured logs carry
- **Sensitive data filtering**: Credentials, cookies, request bodies, query strings, and cardholder data are stripped before transmission
- **Custom events**: `captureException` / `captureMessage` for business-logic errors

## Setup Instructions

### 1. Create a Sentry Project

1. Go to [https://sentry.io/](https://sentry.io/)
2. Sign in or create an account
3. Create a new project:
   - Platform: **Node.js**
   - Alert frequency: **As it happens** (or your preference)
4. After project creation, you'll receive a **DSN** (Data Source Name)

### 2. Configure Environment Variables

| Variable                      | Required | Default              | Purpose                                                                                    |
| ----------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `SENTRY_DSN`                  | No       | _(unset — disabled)_ | `https://<publicKey>@<host>/<projectId>`. Unset disables error tracking entirely.          |
| `SENTRY_ENVIRONMENT`          | No       | `NODE_ENV`           | Environment bucket Sentry groups events by. Set it when several prod deploys need buckets. |
| `SENTRY_RELEASE`              | No       | _(unset)_            | Git SHA or semver tag. Without it Sentry cannot attribute a regression to a deploy.        |
| `SENTRY_TRACES_SAMPLE_RATE`   | No       | `0.1`                | Transaction sampling, `0`–`1`.                                                             |
| `SENTRY_PROFILES_SAMPLE_RATE` | No       | `0`                  | CPU profiling sampling, `0`–`1`. Requires the optional `@sentry/profiling-node` addon.     |

```bash
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
SENTRY_RELEASE=$(git rev-parse --short HEAD)
SENTRY_TRACES_SAMPLE_RATE=0.1
```

The DSN shape is validated twice, on purpose:

- **`src/env.js`** rejects a malformed DSN at boot alongside every other environment mistake, so a typo is loud rather than degrading silently into "error tracking is off" — the failure mode nobody notices until an incident, when there is nothing to look at. The pattern is imported from `lib/sentry-config.js` so the two checks cannot drift.
- **`src/lib/sentry-config.js`** re-checks at init and, if the DSN is bad, logs an error and leaves Sentry disabled rather than throwing. `initSentry()` is the first statement in the entrypoint, so an uncaught throw there would be a total outage. A typo in an optional observability variable must never take the API down.

### 3. Initialization (already wired)

No application code needs to call `initSentry()` — `src/index.js` does it. Two orderings matter and are load-bearing:

```javascript
// src/index.js
require('dotenv').config();
require('./env');

const { initSentry } = require('./lib/sentry-config');
initSentry(); // BEFORE ./app

const app = require('./app'); // express/http are patched by now
```

`initSentry()` must run before `./app` is required. The SDK patches `http` and `express` for automatic instrumentation at init; requiring the app first leaves that instrumentation attached to nothing.

```javascript
// src/app.js
app.use(sentryRequestHandler()); // first middleware
// ... routes ...
app.use(sentryErrorHandler()); // before the app's own error responder
app.use((err, req, res, next) => {
  /* writes the 500 */
});
```

The request handler is the **first** middleware because it opens the per-request scope every later `captureException()` attaches to. The error handler goes **before** the application's own error responder, because that responder terminates the chain — it writes a 500 and never calls `next()`, so anything mounted after it would never see the error.

### 4. Verify Configuration

```bash
SENTRY_DSN=https://<key>@<host>/<project> node -e "
const s = require('./src/lib/sentry-config');
s.initSentry();
s.captureMessage('Test event from Stellar_Card backend', 'error');
s.flush(5000).then(ok => console.log('flushed:', ok));
"
```

You should see a `[sentry] error tracking active (project=..., env=...)` line, then the event in your Sentry dashboard.

## What gets reported

### Automatic

| Source                       | Where it is wired                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Uncaught exceptions          | `src/index.js` process handler, reported at `fatal`                                |
| Unhandled promise rejections | `src/index.js` process handler, reported at `error`                                |
| Express 5xx faults           | `sentryErrorHandler()` in `src/app.js`                                             |
| `log('error', ...)` calls    | `src/lib/logger.js` mirrors error-level logs via `captureMessage`                  |
| Background job failures      | `_runSubJob` in `src/jobs.js`, tagged `subsystem:jobs` + `operation:<job>`         |
| Agent funding-check failures | `checkAgentFundingStatusGuarded` in `src/jobs.js`                                  |
| Alert-evaluator failures     | `startJobs` in `src/jobs.js`, tagged with the `startup` / `tick` phase             |
| Unparseable on-chain events  | `handlePaymentEvent` in `src/payments/stellar.js`                                  |
| Dead-lettered payment events | `handlePaymentEvent` in `src/payments/stellar.js`, after the retry budget is spent |
| A sustained watcher outage   | `poll` in `src/payments/stellar.js`, gated on consecutive failures (see below)     |

Sentry's own `OnUncaughtException` / `OnUnhandledRejection` integrations are **removed** in `buildSentryOptions`. `src/index.js` already owns both signals: it logs a structured `bizEvent` and runs the graceful-shutdown path (drain the Soroban watcher, cancel background jobs, close the HTTP server). Sentry's uncaught-exception integration calls `process.exit()` on a fatal error by default, which would kill in-flight orders before that drain completes. Reporting explicitly from the existing handlers gets the event _and_ the clean shutdown.

Buffered events are flushed (2 s budget) inside the shutdown path, so a crash report captured moments before exit is not lost.

### Not reported

`shouldReportError` in `lib/sentry-config.js` filters the error handler:

- **CORS rejections** (`CORS: origin not allowed`). A client mistake that arrives at whatever rate the open internet decides; it would bury real 500s in noise.
- **Any error carrying a 4xx status.** The caller got a useful response; there is nothing for an engineer to fix.
- Errors with **no** status _are_ reported — an unexpected throw out of a route handler is exactly what this integration exists for.

`ignoreErrors` additionally drops client-side noise forwarded through the SDK: `NetworkError: Failed to fetch`, `NotSupportedError`, `AbortError`.

## Background work

Everything in the first four rows of the table above reports from the request
path. That is the half of the system where a failure already has someone
watching it — a 500 has a client who retries, complains, or opens a ticket.

The background half has nobody. A sub-job can throw on every tick for weeks
and leave nothing but a stderr line and a `bizEvent` that no alert rule reads;
the Soroban watcher can die and the only symptom is that on-chain payments
stop turning into cards. `reportBackgroundFailure` exists for those:

```javascript
const { reportBackgroundFailure } = require('./lib/sentry-config');

reportBackgroundFailure('jobs', 'retryWebhooks', err, { queue_depth: 41 });
```

It does two things a bare `captureException` would not:

- **Runs inside `withScope` and clears the user.** `sentryRequestHandler()`
  gives each HTTP request its own hub, but background work runs on the root
  one. An event tagged with an unrelated `request_id` or agent id is worse
  than an untagged event, because it sends whoever is triaging to the wrong
  tenant.
- **Tags `subsystem` and `operation`.** Background failures carry no
  transaction name, so without them every job failure collapses into one
  Sentry issue and "the webhook retry loop is broken" cannot be told apart
  from "the pruner is broken".

Like the other helpers it never throws, returns `undefined` while disabled,
and needs no `isEnabled()` guard at the call site — the call sites are catch
blocks that have already decided the failure was survivable, so observability
must not be what takes the loop down.

### Why the watcher's poll errors are throttled and its dead letters are not

The watcher's failure modes are not equally interesting.

A **poll error** is usually the public mainnet Soroban RPC being itself: it
times out, rate-limits, and 502s on its own schedule, and the handler exists
to back off 4× and retry. Reporting each one would emit up to one event every
6 s from a healthy deployment and bury the real signal inside it. So the
report is gated on `CONSECUTIVE_POLL_ERRORS_BEFORE_REPORT` (10) consecutive
failures, reset by any successful `getEvents` call, and repeated on each
further multiple so a sustained outage stays visible without one event per
retry. Ten failures at the 4× backoff is roughly a minute of an unreachable
RPC — the same order as the 120 s staleness threshold `/status` uses to call
the watcher stalled.

The counter resets where the RPC answers, not at the end of the successful
path, so a throw out of `handlePaymentEvent` — our bug, not the RPC's — is not
credited as a recovery.

An **unparseable event** or a **dead-lettered dispatch** is never weather.
Both mean a payment landed in the receiver contract and no card came out, and
in the dead-letter case the retry budget is already spent by the time the
report fires. Those go to Sentry unconditionally. `/status` does expose the
dead-letter count, but that is a pull signal on a dashboard nobody is reading
at 3am.

## Manual reporting

```javascript
const { captureException, captureMessage } = require('./lib/sentry-config');

try {
  await payCtxOrder(order);
} catch (err) {
  captureException(err, {
    tags: { operation: 'ctx-payment' },
    extra: { order_id: order.id },
  });
}

captureMessage('Reconciler parked an ambiguous payment', 'warning', {
  extra: { order_id: order.id },
});
```

Both return the Sentry event id when tracking is active, and `undefined` when it is not. Neither throws, and neither needs an `if (isEnabled())` guard at the call site.

### User context

```javascript
const { setUserContext, clearUserContext } = require('./lib/sentry-config');

setUserContext(apiKey.id); // opaque id only — never the email
clearUserContext();
```

Send opaque identifiers. Emails are PII that a stack trace has no need for, and `sendDefaultPii` is hard-set to `false` so the SDK never attaches IPs, cookies, or bodies on its own initiative.

`src/middleware/auth.js` calls `setUserContext(apiKey.id, { dashboard_id })` on
every successful `/v1` authentication, so a 5xx from the agent API answers the
first question anyone asks about one: is this a single broken integration or is
it everybody? It passes the api key id and the tenant it belongs to, and
nothing else — not the label, not the operator's email.

There is no matching `clearUserContext()` on the request path, and there must
not be: `sentryRequestHandler()` is mounted first in `src/app.js` and runs each
request in its own hub, so the identity is already request-scoped. This is the
same reason `setRequestId` works from that middleware. `clearUserContext()` is
for the background path, where `reportBackgroundFailure` calls
`scope.setUser(null)` for you.

## Sensitive data filtering

`beforeSend` runs `scrubEvent`, which:

- Redacts request headers by name (case-insensitively): `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-vcc-signature`, `x-signature`, `idempotency-key`, `proxy-authorization`. Everything else — `user-agent`, `content-type` — survives, because that is what makes an event triageable.
- Drops the **entire request body**. Bodies on this API carry claim codes, login OTPs, and webhook payloads; none of it helps triage and all of it is sensitive.
- Drops the query string and cookies, and strips the query component from the request URL while keeping the path.
- Recursively redacts secret and cardholder fields anywhere in `extra`, `contexts`, and breadcrumb data: `card_number`, `card_cvv`, `cvv`, `cvc`, `pan`, `card_expiry`, `api_key`, `webhook_secret`, `callback_secret`, `sealed_payload`, `secret`, `password`, `token`, `code_hash`, `key_hash`, plus `_`-suffixed variants such as `vcc_callback_secret`.

Matching is exact-or-suffixed rather than substring, so `token_count` and `tokenizer` are left alone. Redaction is depth-bounded (8 levels) and returns copies rather than mutating — Sentry hands `beforeSend` live references to objects the application may still be using, and an in-place redaction would corrupt an order record mid-request.

To add a field, extend `REDACTED_FIELDS` (or `REDACTED_HEADERS`) at the top of `src/lib/sentry-config.js`; the tests in `test/unit/sentry-config.test.js` cover the behaviour directly, no live transport required.

## Profiling

Profiling is **off by default** and its native addon is loaded optionally:

```bash
npm install @sentry/profiling-node
SENTRY_PROFILES_SAMPLE_RATE=0.1
```

`@sentry/profiling-node` is a native addon and is not a declared dependency of this package. It is required lazily and only when `SENTRY_PROFILES_SAMPLE_RATE > 0`; if the sample rate is set but the module is missing, the backend warns once and continues without profiling rather than refusing to boot.

## Environment behaviour

Sentry is gated on **"did `initSentry()` succeed"**, not on `NODE_ENV`:

| Situation                        | Result                                                         |
| -------------------------------- | -------------------------------------------------------------- |
| No `SENTRY_DSN`                  | Disabled. Warned once at boot in production, silent elsewhere. |
| Malformed `SENTRY_DSN`           | Disabled, error logged. The process still boots.               |
| Valid `SENTRY_DSN`, any NODE_ENV | Enabled, events tagged with `SENTRY_ENVIRONMENT ?? NODE_ENV`.  |

This is deliberate. Gating on `NODE_ENV === 'production'` made `captureException()` a hard no-op everywhere else — the scrubbing logic could not be exercised by the test suite at all, and a developer pointing `SENTRY_DSN` at a scratch project to reproduce an issue locally got silence. The test suite never sets `SENTRY_DSN`, so it exercises the disabled path and sends nothing.

## Testing

`test/unit/sentry-config.test.js` covers the module without any network access:

- The scrubbing rules and the option builder are pure functions exported under `_`-prefixed names and asserted directly.
- The public API is a hard no-op until `initSentry()` succeeds, so the disabled-path tests prove the no-op contract rather than queueing real events.
- Only the paths that leave Sentry **disabled** (no DSN, malformed DSN) exercise `initSentry`. Successfully initialising the SDK is a process-global, one-way side effect — the module caches `initialized` and Sentry installs a global hub and patches `http`/`express` — so doing it inside a shared test runner would leak into every subsequent test.

`test/unit/sentry-background.test.js` covers the **enabled** path, which is why
it is a separate file: `node:test` runs one process per file, so it gets its own
module registry and can initialise for real against a syntactically valid DSN
that points nowhere. It replaces `Sentry.captureException` and `Sentry.withScope`
with recorders and asserts on what the SDK was asked to send — the tags, the
cleared user, the extras, that a non-Error throw is passed through unconverted,
and that a throw from inside the SDK is swallowed. It also drives `_runSubJob`
from `src/jobs.js` end to end, so removing the report from the job loop fails
the suite.

Its first test asserts `initSentry()` returned `true`. That is not ceremony:
every helper is a documented no-op while disabled, so without it the whole file
would pass just as happily against functions that do nothing.

## Monitoring and Alerts

1. Go to your Sentry project settings
2. Navigate to **Alerts** → **Alert Rules**
3. Create an alert rule:
   - **Trigger**: `An event is seen`
   - **Filter**: Select issue type (errors, performance, etc.)
   - **Action**: Email, Slack, webhook, etc.

Useful rules for this service:

- **New issue**: first occurrence of a new error
- **Error spike**: sudden increase in error rate
- **Tagged criticals**: filter on `operation:ctx-payment` or `origin:uncaughtException`
- **Performance degradation**: transaction latency increase

## Troubleshooting

### Events not appearing

1. Look for `[sentry] error tracking active` in stdout at boot. If it is absent, Sentry never initialised.
2. `[sentry] SENTRY_DSN is malformed` means the shape check rejected the value — check for kept shell quotes, a pasted project URL instead of a DSN, or a missing project id.
3. `[sentry] SENTRY_DSN not configured` means the variable is unset or empty.
4. Confirm the server can reach `*.ingest.sentry.io`.
5. Short-lived scripts need `await flush()` before exiting — events are sent asynchronously.

### Too many events

1. Lower `SENTRY_TRACES_SAMPLE_RATE`.
2. Extend `ignoreErrors` or tighten `shouldReportError` in `src/lib/sentry-config.js`.
3. Configure server-side sampling in your Sentry project settings.

### Performance impact

- Request handler middleware: ~1 ms per request
- Error handler middleware: only invoked on errors
- Event sending: asynchronous, non-blocking
- Sampling: reduces event volume and cost
- When disabled: two pass-through middleware calls and one function call per error log

## Best Practices

1. **Tag errors consistently** — use tags to categorise by operation or subsystem
2. **Add context** — order ids, api key ids, and other correlating identifiers
3. **Set `SENTRY_RELEASE`** — without it a regression cannot be traced to a deploy
4. **Set sampling appropriately** — balance cost against visibility
5. **Never pass PII or secrets in custom fields** — the scrubber is a safety net, not a licence

## References

- [Sentry Documentation](https://docs.sentry.io/)
- [Sentry Node.js Integration](https://docs.sentry.io/platforms/node/)
- [Performance Monitoring](https://docs.sentry.io/platforms/node/performance/)
- [Profiling Guide](https://docs.sentry.io/product/profiling/)
