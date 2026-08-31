// Integration tests for the Zod request-validation layer as it is
// actually mounted on the agent and dashboard routes.
//
// The unit suite (test/unit/validate.test.js) covers the middleware's own
// contract. These tests answer the question that only a real request can:
// does each route still return the exact `error` code its clients — and
// the rest of this suite — depend on, now that the checks live in a
// schema instead of a sequence of `if` statements?
//
// They also cover the behaviour the schemas ADD: query-parameter
// whitelisting and timestamp validation on GET /v1/orders, which
// previously accepted anything and silently returned an empty list.

require('../helpers/env');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { request, createTestKey, seedOrder, resetDb } = require('../helpers/app');

// POST /v1/orders reaches an XLM price lookup only after validation
// passes; every request in this file is expected to fail validation, so
// no outbound call should ever be made. A throwing stub makes that
// assumption explicit — if a test ever gets past validation unexpectedly,
// it fails loudly here rather than hanging on a real network call.
global.fetch = async (url) => {
  throw new Error(`unexpected outbound fetch in a validation test: ${url}`);
};

describe('POST /v1/orders — body validation contract', () => {
  /** @type {any} */ let key;

  beforeEach(async () => {
    resetDb();
    key = await createTestKey({ label: 'validation' });
  });

  function post(body) {
    return request.post('/v1/orders').set('X-Api-Key', key.key).send(body);
  }

  it('rejects a JSON array body with invalid_request', async () => {
    const res = await post([{ amount_usdc: '10.00' }]);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
    assert.match(res.body.message, /must be a JSON object/);
  });

  it('rejects a missing amount with invalid_amount', async () => {
    const res = await post({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_amount');
  });

  it('rejects a numeric amount with invalid_amount', async () => {
    // JSON numbers lose cents to float representation, so amounts are
    // strings on the wire and a number is a client bug, not a coercion
    // opportunity.
    const res = await post({ amount_usdc: 10 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_amount');
  });

  it('rejects a trailing-garbage amount that parseFloat would accept', async () => {
    const res = await post({ amount_usdc: '10abc' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_amount');
    assert.match(res.body.message, /at most 2 decimal places/);
  });

  it('rejects sub-cent precision the issuer cannot represent', async () => {
    const res = await post({ amount_usdc: '10.12345' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_amount');
  });

  it('rejects a zero amount with the positive-number message', async () => {
    const res = await post({ amount_usdc: '0' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_amount');
    assert.match(res.body.message, /positive number/);
  });

  it('rejects a negative amount', async () => {
    const res = await post({ amount_usdc: '-5.00' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_amount');
  });

  it('rejects an amount above the platform ceiling', async () => {
    const res = await post({ amount_usdc: '10000.01' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_amount');
    assert.match(res.body.message, /cannot exceed/);
  });

  it('rejects a non-string webhook_url with invalid_webhook_url', async () => {
    const res = await post({ amount_usdc: '10.00', webhook_url: 42 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_webhook_url');
    assert.match(res.body.message, /must be a string/);
  });

  it('rejects an over-long webhook_url before any DNS resolution', async () => {
    const res = await post({
      amount_usdc: '10.00',
      webhook_url: `https://example.com/${'a'.repeat(3000)}`,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_webhook_url');
    assert.match(res.body.message, /at most 2048 characters/);
  });

  it('rejects array metadata with invalid_metadata', async () => {
    const res = await post({ amount_usdc: '10.00', metadata: [1, 2, 3] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_metadata');
  });

  it('rejects a metadata string with invalid_metadata', async () => {
    const res = await post({ amount_usdc: '10.00', metadata: 'not-an-object' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_metadata');
  });

  it('rejects metadata over the serialised size budget', async () => {
    const res = await post({ amount_usdc: '10.00', metadata: { blob: 'x'.repeat(9000) } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_metadata');
    assert.match(res.body.message, /at most 8192 bytes/);
  });

  it('reports the amount error first when several fields are invalid', async () => {
    // Preserves the top-down ordering of the sequential guards this
    // schema replaced.
    const res = await post({ amount_usdc: 'abc', webhook_url: 42, metadata: [] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_amount');
  });
});

describe('GET /v1/orders — query validation', () => {
  /** @type {any} */ let key;

  beforeEach(async () => {
    resetDb();
    key = await createTestKey({ label: 'validation-query' });
  });

  function get(qs) {
    return request.get(`/v1/orders${qs}`).set('X-Api-Key', key.key);
  }

  it('accepts a known status filter', async () => {
    seedOrder({ api_key_id: key.id, status: 'delivered' });
    seedOrder({ api_key_id: key.id, status: 'pending_payment' });
    const res = await get('?status=delivered');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
  });

  it('rejects an unknown status instead of returning an empty list', async () => {
    // The old behaviour returned 200 with [], which reads to the caller
    // as "you have no orders" rather than "you typo'd the filter".
    seedOrder({ api_key_id: key.id, status: 'delivered' });
    const res = await get('?status=delivred');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_status');
    assert.match(res.body.message, /must be one of/);
  });

  it('treats an empty status as no filter', async () => {
    seedOrder({ api_key_id: key.id, status: 'delivered' });
    const res = await get('?status=');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
  });

  it('rejects a malformed since_created_at', async () => {
    // These are compared lexically against an ISO column, so a
    // malformed bound silently matches everything or nothing.
    const res = await get('?since_created_at=yesterday');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_since_created_at');
  });

  it('rejects a malformed since_updated_at', async () => {
    const res = await get('?since_updated_at=not-a-date');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_since_updated_at');
  });

  it('accepts a well-formed since_created_at', async () => {
    seedOrder({ api_key_id: key.id });
    const res = await get('?since_created_at=2000-01-01T00:00:00.000Z');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
  });

  it('clamps an over-large limit rather than erroring', async () => {
    for (let i = 0; i < 3; i += 1) seedOrder({ api_key_id: key.id });
    const res = await get('?limit=99999');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
  });

  it('honours a valid limit', async () => {
    for (let i = 0; i < 3; i += 1) seedOrder({ api_key_id: key.id });
    const res = await get('?limit=2');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
  });

  it('honours a valid offset', async () => {
    for (let i = 0; i < 3; i += 1) seedOrder({ api_key_id: key.id });
    const res = await get('?offset=2');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
  });

  it('falls back to the default for an unparseable limit', async () => {
    for (let i = 0; i < 3; i += 1) seedOrder({ api_key_id: key.id });
    const res = await get('?limit=abc');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 3);
  });

  it('ignores unrecognised query parameters', async () => {
    seedOrder({ api_key_id: key.id });
    const res = await get('?sort_by=amount&unexpected=1');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
  });
});

describe('POST /auth/login — body validation contract', () => {
  beforeEach(() => resetDb());

  function post(body) {
    return request.post('/auth/login').send(body);
  }

  it('rejects a JSON array body with invalid_request', async () => {
    const res = await post([{ email: 'a@b.com' }]);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  });

  it('rejects a missing email with invalid_email', async () => {
    const res = await post({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_email');
    assert.equal(res.body.message, 'A valid email address is required.');
  });

  it('rejects an array email with invalid_email', async () => {
    const res = await post({ email: ['a@b.com'] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_email');
  });

  it('rejects an address with no @ or no dot', async () => {
    for (const email of ['not-an-email', 'missing@dot', 'no at.sign']) {
      const res = await post({ email });
      assert.equal(res.status, 400, email);
      assert.equal(res.body.error, 'invalid_email', email);
    }
  });

  it('accepts a surrounding-whitespace address', async () => {
    const res = await post({ email: '  someone@example.com  ' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });
});

describe('POST /auth/verify — body validation contract', () => {
  beforeEach(() => resetDb());

  function post(body) {
    return request.post('/auth/verify').send(body);
  }

  it('rejects a JSON array body with invalid_request', async () => {
    const res = await post([{ email: 'a@b.com', code: '123456' }]);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  });

  it('rejects a missing code with missing_fields', async () => {
    const res = await post({ email: 'a@b.com' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_fields');
  });

  it('rejects a missing email with missing_fields', async () => {
    const res = await post({ code: '123456' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_fields');
  });

  it('rejects an array email with missing_fields, not a 500', async () => {
    // The pre-schema guard tested truthiness before type, so an array
    // reached normalizeEmail(email).trim() — which arrays do not have.
    const res = await post({ email: ['a@b.com'], code: '123456' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_fields');
  });

  it('rejects a numeric code with missing_fields', async () => {
    const res = await post({ email: 'a@b.com', code: 123456 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_fields');
  });

  it('rejects empty strings with missing_fields', async () => {
    const res = await post({ email: '', code: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_fields');
  });

  it('does not reveal which of the two fields was wrong', async () => {
    // Verify is an authentication boundary: the message must be
    // identical whichever half is missing.
    const noCode = await post({ email: 'a@b.com' });
    const noEmail = await post({ code: '123456' });
    assert.equal(noCode.body.message, noEmail.body.message);
  });
});
