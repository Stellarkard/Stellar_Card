// Unit tests for lib/sentry-config.js.
//
// Nothing here talks to sentry.io. Two things make that possible:
//
//   1. The scrubbing rules and the option builder are pure functions
//      exported under `_`-prefixed names, so they can be asserted
//      directly with no client, no transport, and no network.
//   2. The public API is a hard no-op until initSentry() succeeds, and
//      the test environment never sets SENTRY_DSN — so calling
//      captureException() here proves the disabled path rather than
//      queueing a real event.
//
// The init tests deliberately exercise only the paths that leave Sentry
// DISABLED (no DSN, malformed DSN). Successfully initialising the SDK is
// a process-global, one-way side effect: the module caches `initialized`
// and Sentry installs a global hub and patches http/express. Doing that
// inside a shared test runner would leak into every test that follows.

require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const sentry = require('../../src/lib/sentry-config');

// ── DSN validation ─────────────────────────────────────────────────────────

describe('sentry-config — DSN validation', () => {
  it('accepts a well-formed DSN', () => {
    assert.ok(sentry._DSN_SHAPE.test('https://abc123@o4507.ingest.sentry.io/1234567'));
  });

  it('accepts the legacy publicKey:secretKey form', () => {
    assert.ok(sentry._DSN_SHAPE.test('https://public:secret@sentry.example.com/42'));
  });

  it('accepts a self-hosted http DSN', () => {
    assert.ok(sentry._DSN_SHAPE.test('http://abc123@sentry.internal:9000/7'));
  });

  for (const [label, bad] of [
    ['an empty string', ''],
    ['a bare hostname', 'sentry.io'],
    ['a project URL rather than a DSN', 'https://sentry.io/organizations/acme/projects/api/'],
    ['a DSN with no project id', 'https://abc123@o4507.ingest.sentry.io/'],
    ['a DSN with a non-numeric project id', 'https://abc123@o4507.ingest.sentry.io/abc'],
    ['a DSN with no public key', 'https://@o4507.ingest.sentry.io/1'],
    ['a value that kept its shell quotes', '"https://abc123@o4507.ingest.sentry.io/1"'],
    ['a DSN with embedded whitespace', 'https://abc 123@o4507.ingest.sentry.io/1'],
  ]) {
    it(`rejects ${label}`, () => {
      assert.equal(sentry._DSN_SHAPE.test(bad), false, bad);
    });
  }
});

// ── initSentry ─────────────────────────────────────────────────────────────

describe('sentry-config — initSentry', () => {
  it('stays disabled and does not throw when no DSN is configured', () => {
    const result = sentry.initSentry({ NODE_ENV: 'test' });
    assert.equal(result, false);
    assert.equal(sentry.isEnabled(), false);
  });

  it('treats a whitespace-only DSN as unset', () => {
    assert.equal(sentry.initSentry({ NODE_ENV: 'test', SENTRY_DSN: '   ' }), false);
  });

  it('refuses a malformed DSN instead of letting Sentry.init throw', () => {
    // The critical property: a typo in an optional observability variable
    // must not take the process down. initSentry runs as the first
    // statement of the entrypoint, so a throw here is a total outage.
    let result;
    assert.doesNotThrow(() => {
      result = sentry.initSentry({ NODE_ENV: 'production', SENTRY_DSN: 'not-a-dsn' });
    });
    assert.equal(result, false);
    assert.equal(sentry.isEnabled(), false);
  });
});

// ── Disabled-mode behaviour ───────────────────────────────────────────────

describe('sentry-config — behaviour while disabled', () => {
  it('captureException is a silent no-op', () => {
    assert.equal(sentry.captureException(new Error('boom')), undefined);
  });

  it('captureMessage is a silent no-op', () => {
    assert.equal(sentry.captureMessage('hello', 'error'), undefined);
  });

  it('user context helpers are no-ops', () => {
    assert.doesNotThrow(() => sentry.setUserContext('key_123'));
    assert.doesNotThrow(() => sentry.clearUserContext());
    assert.doesNotThrow(() => sentry.setRequestId('req-1'));
  });

  it('flush resolves true immediately', async () => {
    assert.equal(await sentry.flush(1), true);
  });

  it('the request handler passes through to the next middleware', (t, done) => {
    const handler = sentry.sentryRequestHandler();
    handler(/** @type {any} */ ({}), /** @type {any} */ ({}), (err) => {
      assert.equal(err, undefined);
      done();
    });
  });

  it('the error handler forwards the error unchanged', (t, done) => {
    const handler = sentry.sentryErrorHandler();
    const boom = new Error('boom');
    handler(boom, /** @type {any} */ ({}), /** @type {any} */ ({}), (err) => {
      assert.equal(err, boom);
      done();
    });
  });
});

// ── Option construction ───────────────────────────────────────────────────

describe('sentry-config — buildSentryOptions', () => {
  const base = { NODE_ENV: 'production', SENTRY_DSN: 'https://k@sentry.io/1' };

  it('defaults the environment tag to NODE_ENV', () => {
    assert.equal(sentry._buildSentryOptions(base).environment, 'production');
  });

  it('lets SENTRY_ENVIRONMENT override NODE_ENV', () => {
    const opts = sentry._buildSentryOptions({ ...base, SENTRY_ENVIRONMENT: 'canary' });
    assert.equal(opts.environment, 'canary');
  });

  it('never enables sendDefaultPii', () => {
    // The SDK would otherwise attach IPs, cookies and request bodies on
    // its own initiative, bypassing the scrubbing below entirely.
    assert.equal(sentry._buildSentryOptions(base).sendDefaultPii, false);
  });

  it('defaults traces sampling to 0.1 and profiling to off', () => {
    const opts = sentry._buildSentryOptions(base);
    assert.equal(opts.tracesSampleRate, 0.1);
    assert.equal(opts.profilesSampleRate, 0);
  });

  it('honours explicit sample rates', () => {
    const opts = sentry._buildSentryOptions({
      ...base,
      SENTRY_TRACES_SAMPLE_RATE: '0.5',
      SENTRY_PROFILES_SAMPLE_RATE: '1',
    });
    assert.equal(opts.tracesSampleRate, 0.5);
    assert.equal(opts.profilesSampleRate, 1);
  });

  it('falls back to the default for an out-of-range sample rate', () => {
    // A typo in a sampling knob must not stop the process from booting,
    // and must not accidentally sample at 100x the intended rate.
    for (const bad of ['2', '-1', 'abc', 'NaN', 'Infinity']) {
      assert.equal(
        sentry._buildSentryOptions({ ...base, SENTRY_TRACES_SAMPLE_RATE: bad }).tracesSampleRate,
        0.1,
        bad,
      );
    }
  });

  it('does not load the optional profiling addon when profiling is off', () => {
    // @sentry/profiling-node is a native addon and not a declared
    // dependency. Requiring it unconditionally at module load is what
    // made this module throw MODULE_NOT_FOUND for every consumer.
    const opts = sentry._buildSentryOptions(base);
    assert.doesNotThrow(() => opts.integrations([]));
  });

  it('drops the SDK process-signal integrations', () => {
    // index.js owns uncaughtException / unhandledRejection: it runs the
    // graceful-shutdown drain. Sentry's OnUncaughtException integration
    // calls process.exit() on a fatal error, which would kill in-flight
    // orders mid-drain.
    const defaults = [
      { name: 'Http' },
      { name: 'OnUncaughtException' },
      { name: 'OnUnhandledRejection' },
      { name: 'ContextLines' },
    ];
    const names = sentry
      ._buildSentryOptions(base)
      .integrations(defaults)
      .map((/** @type {any} */ i) => i.name);
    assert.deepEqual(names, ['Http', 'ContextLines']);
  });

  it('wires beforeSend to the scrubber', () => {
    const opts = sentry._buildSentryOptions(base);
    const event = opts.beforeSend({ request: { headers: { Authorization: 'Bearer secret' } } });
    assert.equal(event.request.headers.Authorization, '[redacted]');
  });

  it('wires beforeBreadcrumb to the redactor', () => {
    const opts = sentry._buildSentryOptions(base);
    const crumb = opts.beforeBreadcrumb({ data: { api_key: 'stellar_card_live_abc' } });
    assert.equal(crumb.data.api_key, '[redacted]');
  });
});

// ── Scrubbing ─────────────────────────────────────────────────────────────

describe('sentry-config — event scrubbing', () => {
  it('redacts every credential-bearing request header', () => {
    const event = sentry._scrubEvent({
      request: {
        headers: {
          Authorization: 'Bearer session-token',
          'x-api-key': 'stellar_card_live_abc',
          Cookie: 'sid=abc',
          'X-VCC-Signature': 'sha256=deadbeef',
          'Idempotency-Key': 'idem-1',
          'User-Agent': 'stellar_card-sdk/1.0',
          'Content-Type': 'application/json',
        },
      },
    });
    const headers = event.request.headers;
    assert.equal(headers.Authorization, '[redacted]');
    assert.equal(headers['x-api-key'], '[redacted]');
    assert.equal(headers.Cookie, '[redacted]');
    assert.equal(headers['X-VCC-Signature'], '[redacted]');
    assert.equal(headers['Idempotency-Key'], '[redacted]');
    // Non-sensitive headers survive — they are what makes an event
    // triageable in the first place.
    assert.equal(headers['User-Agent'], 'stellar_card-sdk/1.0');
    assert.equal(headers['Content-Type'], 'application/json');
  });

  it('matches header names case-insensitively', () => {
    const event = sentry._scrubEvent({
      request: { headers: { AUTHORIZATION: 'Bearer x', 'X-Api-Key': 'k' } },
    });
    assert.equal(event.request.headers.AUTHORIZATION, '[redacted]');
    assert.equal(event.request.headers['X-Api-Key'], '[redacted]');
  });

  it('drops the request body wholesale', () => {
    // Bodies on this API carry claim codes, login OTPs and webhook
    // payloads. None of it helps triage; all of it is sensitive.
    const event = sentry._scrubEvent({
      request: { data: { code: 'claim-code-123', amount_usdc: '10.00' } },
    });
    assert.equal(event.request.data, '[redacted]');
  });

  it('drops the query string and cookies', () => {
    const event = sentry._scrubEvent({
      request: { query_string: 'api_key=leaked', cookies: { sid: 'abc' } },
    });
    assert.equal(event.request.query_string, '[redacted]');
    assert.equal(event.request.cookies, '[redacted]');
  });

  it('keeps the URL path but strips its query component', () => {
    const event = sentry._scrubEvent({
      request: { url: 'https://api.stellar_card.com/v1/orders/abc?api_key=leaked' },
    });
    assert.equal(event.request.url, 'https://api.stellar_card.com/v1/orders/abc?[redacted]');
  });

  it('leaves a URL with no query component untouched', () => {
    const url = 'https://api.stellar_card.com/v1/orders/abc';
    const event = sentry._scrubEvent({ request: { url } });
    assert.equal(event.request.url, url);
  });

  it('redacts cardholder data anywhere in extra', () => {
    const event = sentry._scrubEvent({
      extra: {
        order: {
          id: 'ord_1',
          card_number: '4111111111111111',
          card_cvv: '123',
          card_expiry: '12/29',
          amount_usdc: '10.00',
        },
      },
    });
    assert.equal(event.extra.order.card_number, '[redacted]');
    assert.equal(event.extra.order.card_cvv, '[redacted]');
    assert.equal(event.extra.order.card_expiry, '[redacted]');
    // Non-sensitive fields must survive, or the event is useless.
    assert.equal(event.extra.order.id, 'ord_1');
    assert.equal(event.extra.order.amount_usdc, '10.00');
  });

  it('redacts secrets in contexts and inside arrays', () => {
    const event = sentry._scrubEvent({
      contexts: {
        keys: [
          { id: 'k1', webhook_secret: 'whsec_abc' },
          { id: 'k2', sealed_payload: 'base64...' },
        ],
      },
    });
    assert.equal(event.contexts.keys[0].webhook_secret, '[redacted]');
    assert.equal(event.contexts.keys[1].sealed_payload, '[redacted]');
    assert.equal(event.contexts.keys[0].id, 'k1');
  });

  it('redacts suffixed variants like vcc_callback_secret', () => {
    const out = /** @type {any} */ (
      sentry._redactDeep({ vcc_callback_secret: 'x', request_token: 'y', description: 'keep' })
    );
    assert.equal(out.vcc_callback_secret, '[redacted]');
    assert.equal(out.request_token, '[redacted]');
    assert.equal(out.description, 'keep');
  });

  it('does not redact an unrelated field that merely contains a keyword', () => {
    // `token_count` is not a token. Substring matching here would gut
    // useful diagnostics, so matching is exact-or-suffixed only.
    const out = /** @type {any} */ (sentry._redactDeep({ token_count: 12, tokenizer: 'v2' }));
    assert.equal(out.token_count, 12);
    assert.equal(out.tokenizer, 'v2');
  });

  it('redacts breadcrumb data', () => {
    const event = sentry._scrubEvent({
      breadcrumbs: [
        { message: 'db query', data: { key_hash: '$2a$10$abc', table: 'api_keys' } },
        { message: 'no data crumb' },
      ],
    });
    assert.equal(event.breadcrumbs[0].data.key_hash, '[redacted]');
    assert.equal(event.breadcrumbs[0].data.table, 'api_keys');
    assert.equal(event.breadcrumbs[1].message, 'no data crumb');
  });

  it('does not mutate the caller-owned objects it redacts', () => {
    // Sentry hands beforeSend live references to objects the application
    // may still be using — a naive in-place redaction would corrupt an
    // order record mid-request.
    const original = { card_number: '4111111111111111' };
    const copy = /** @type {any} */ (sentry._redactDeep(original));
    assert.equal(copy.card_number, '[redacted]');
    assert.equal(original.card_number, '4111111111111111');
  });

  it('survives a deeply nested payload without blowing the stack', () => {
    /** @type {any} */ let deep = { card_number: 'x' };
    for (let i = 0; i < 200; i += 1) deep = { nested: deep };
    assert.doesNotThrow(() => sentry._redactDeep(deep));
  });

  it('survives a circular payload', () => {
    /** @type {any} */ const circular = { name: 'loop' };
    circular.self = circular;
    assert.doesNotThrow(() => sentry._redactDeep(circular));
  });

  it('tolerates an event with no request, extra, or breadcrumbs', () => {
    assert.deepEqual(sentry._scrubEvent({ message: 'plain' }), { message: 'plain' });
  });

  it('tolerates null and non-object events', () => {
    assert.equal(sentry._scrubEvent(null), null);
    assert.equal(sentry._scrubEvent(undefined), undefined);
    assert.equal(sentry._scrubEvent('string'), 'string');
  });
});

// ── Express error-handler predicate ───────────────────────────────────────
//
// A predicate that reports everything buries real 500s under CORS noise
// from the open internet; one that reports nothing makes the whole
// integration pointless. Both directions are asserted.

describe('sentry-config — shouldReportError', () => {
  it('reports a bare error with no status', () => {
    // An unexpected throw out of a route handler is the case this
    // integration exists for.
    assert.equal(sentry._shouldReportError(new Error('unexpected')), true);
  });

  it('reports a 500', () => {
    assert.equal(
      sentry._shouldReportError(Object.assign(new Error('boom'), { status: 500 })),
      true,
    );
  });

  it('reports a 503', () => {
    assert.equal(
      sentry._shouldReportError(Object.assign(new Error('frozen'), { statusCode: 503 })),
      true,
    );
  });

  it('ignores the CORS rejection app.js raises for a disallowed origin', () => {
    assert.equal(sentry._shouldReportError(new Error('CORS: origin not allowed')), false);
  });

  it('ignores 4xx errors', () => {
    for (const status of [400, 401, 403, 404, 429]) {
      assert.equal(
        sentry._shouldReportError(Object.assign(new Error('client'), { status })),
        false,
        `status ${status}`,
      );
    }
  });

  it('reports an error whose status is not a number', () => {
    // Fail open: an unparseable status is a bug in whatever set it, and
    // dropping the event would hide the real fault behind it.
    assert.equal(
      sentry._shouldReportError(Object.assign(new Error('weird'), { status: 'teapot' })),
      true,
    );
  });

  it('tolerates a non-error value being thrown', () => {
    assert.equal(sentry._shouldReportError('a string'), true);
    assert.equal(sentry._shouldReportError(null), true);
    assert.equal(sentry._shouldReportError(undefined), true);
  });

  it('ignores client-side noise forwarded by the SDK', () => {
    assert.deepEqual(sentry._buildSentryOptions({ NODE_ENV: 'production' }).ignoreErrors, [
      'NetworkError: Failed to fetch',
      'NotSupportedError',
      'AbortError',
    ]);
  });
});
