// End-to-end coverage for the error-handling chain extracted in #377.
//
// The unit suite (test/unit/middleware-error-handling.test.js) pins each
// middleware's own contract. This file pins the part a unit test cannot
// see: the *mount order* in src/app.js. Getting that order wrong fails
// silently rather than loudly —
//
//   notFound before the routes   → every request 404s, but the 404 tests
//                                  still pass, so nothing catches it
//   corsDenial after Sentry      → a browser Origin typo pages on-call
//   errorHandler before cors     → CORS denials come back as 500
//
// Each test below therefore asserts on a real HTTP response, and at least
// one is written to fail if the corresponding layer is missing.

require('../helpers/env');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { request, createTestKey, resetDb } = require('../helpers/app');

describe('error handling chain — 404', () => {
  // `app.use('/v1', auth)` authenticates the whole prefix, so an
  // unauthenticated request to a nonexistent /v1 path is a 401 and never
  // reaches notFound. Reaching the 404 layer therefore needs either a
  // path outside /v1 or a valid key — noted here because it is easy to
  // write a 404 test that passes for the wrong reason.
  it('answers an unmatched route with JSON, not the Express HTML page', async () => {
    const res = await request.get('/nope');

    assert.equal(res.status, 404);
    // Content-Type is the observable difference from Express's default
    // fallback: an SDK that json.parses the body fails with a syntax
    // error instead of learning the route does not exist.
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.body.error, 'not_found');
    assert.match(res.body.message, /GET \/nope/);
  });

  it('answers an authenticated request to a nonexistent /v1 route with 404', async () => {
    const key = await createTestKey();
    const res = await request.get('/v1/orderz').set('X-Api-Key', key.key);

    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'not_found');
    assert.match(res.body.message, /GET \/v1\/orderz/);
  });

  it('names the method, so a wrong verb is distinguishable from a wrong path', async () => {
    const key = await createTestKey();
    // /v1/orders/:id exists for GET but not for DELETE.
    const res = await request.delete('/v1/orders/some-id').set('X-Api-Key', key.key);
    assert.equal(res.status, 404);
    assert.match(res.body.message, /^No route for DELETE /);
  });

  it('does not return 404 for a route that does exist', async () => {
    // The notFound layer must be registered *after* the routes. This is
    // the assertion that fails if the ordering is ever inverted.
    const key = await createTestKey();
    const res = await request.get('/v1/orders').set('X-Api-Key', key.key);
    assert.notEqual(res.status, 404);
    assert.equal(res.status, 200);
  });

  it('returns 401, not 404, for an unauthenticated request to a known route', async () => {
    // Auth is mounted on the whole /v1 prefix, ahead of routing. If the
    // notFound layer were ever hoisted above it, a client with an expired
    // key would be told the route does not exist and would never
    // re-authenticate.
    const res = await request.get('/v1/orders');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'missing_api_key');
  });
});

describe('error handling chain — CORS denial', () => {
  // CORS_ORIGINS is unset in the test env, so app.js falls back to this.
  // Deriving it rather than hardcoding keeps the test honest if the
  // default ever changes.
  const ALLOWED_ORIGIN = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',')[0].trim();

  beforeEach(() => {
    resetDb();
  });

  it('answers a disallowed Origin with a structured 403', async () => {
    const res = await request.get('/v1/orders').set('Origin', 'https://evil.example.com');

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'forbidden');
    assert.equal(res.body.message, 'Origin not allowed');
  });

  it('does not leak the internal cors() message', async () => {
    const res = await request.get('/v1/orders').set('Origin', 'https://evil.example.com');
    // The raw message is "CORS: origin not allowed" — an internal detail
    // that tells an attacker which check fired.
    assert.doesNotMatch(JSON.stringify(res.body), /CORS:/);
  });

  it('does not report a client Origin mistake as a server error', async () => {
    // The regression this whole layer exists for: unhandled, cors()'s
    // Error fell through to the generic 500 and told the browser the
    // server was broken.
    const res = await request.get('/v1/orders').set('Origin', 'https://evil.example.com');
    assert.notEqual(res.status, 500);
  });

  it('lets an allowed Origin through to normal handling', async () => {
    const key = await createTestKey();
    const res = await request
      .get('/v1/orders')
      .set('X-Api-Key', key.key)
      .set('Origin', ALLOWED_ORIGIN);

    assert.equal(res.status, 200);
  });

  it('denies a disallowed Origin on a POST too', async () => {
    const res = await request
      .post('/v1/orders')
      .set('Origin', 'https://evil.example.com')
      .send({ amount_usdc: '10.00' });

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'forbidden');
  });

  it('checks the Origin before auth, so a browser gets 403 rather than 401', async () => {
    // cors() is mounted ahead of the /v1 auth middleware. A browser
    // cannot read a 401 body from a cross-origin response anyway, so a
    // 403 is the only code it can actually act on.
    const res = await request
      .get('/v1/orders')
      .set('Origin', 'https://evil.example.com')
      .set('X-Api-Key', 'not-a-real-key');

    assert.equal(res.status, 403);
  });
});

describe('error handling chain — internal errors', () => {
  beforeEach(() => {
    resetDb();
  });

  it('returns a JSON 500 with a req_id rather than an HTML crash page', async () => {
    // Force a throw from inside a route that is otherwise valid.
    const db = require('../helpers/app').db;
    const key = await createTestKey();
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (/FROM orders WHERE id/.test(sql)) throw new Error('simulated driver failure');
      return realPrepare(sql);
    };

    try {
      const orderId = require('../helpers/app').seedOrder({ api_key_id: key.id });
      const res = await request.get(`/v1/orders/${orderId}`).set('X-Api-Key', key.key);

      assert.equal(res.status, 500);
      assert.match(res.headers['content-type'], /application\/json/);
      assert.equal(res.body.error, 'internal_error');
      assert.ok(
        res.body.req_id,
        'a req_id lets support correlate the client report with the log line',
      );
    } finally {
      db.prepare = realPrepare;
    }
  });

  it('never returns the underlying error message to the client', async () => {
    const db = require('../helpers/app').db;
    const key = await createTestKey();
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (/FROM orders WHERE id/.test(sql)) {
        throw new Error('pg://admin:hunter2@db.internal:5432/orders');
      }
      return realPrepare(sql);
    };

    try {
      const orderId = require('../helpers/app').seedOrder({ api_key_id: key.id });
      const res = await request.get(`/v1/orders/${orderId}`).set('X-Api-Key', key.key);

      assert.equal(res.status, 500);
      assert.doesNotMatch(JSON.stringify(res.body), /hunter2|db\.internal/);
    } finally {
      db.prepare = realPrepare;
    }
  });
});
