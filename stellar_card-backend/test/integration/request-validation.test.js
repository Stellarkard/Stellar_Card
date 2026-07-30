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
const { v4: uuidv4 } = require('uuid');
const {
  request,
  db,
  createTestKey,
  createTestSession,
  seedOrder,
  resetDb,
} = require('../helpers/app');

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

  it('rejects a whitespace-only code with missing_fields', async () => {
    // The handler hashes `code.trim()`, so a whitespace-only code
    // previously passed the truthiness guard and hashed to the empty
    // string — one shared hash for every such request.
    const res = await post({ email: 'a@b.com', code: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_fields');
  });
});

describe('POST /v1/agent/status — body validation contract', () => {
  /** @type {any} */ let key;

  beforeEach(async () => {
    resetDb();
    key = await createTestKey({ label: 'validation-agent' });
  });

  function post(body) {
    return request.post('/v1/agent/status').set('X-Api-Key', key.key).send(body);
  }

  it('rejects a JSON array body with invalid_request', async () => {
    const res = await post([{ state: 'funded' }]);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  });

  it('rejects an unknown state with invalid_state', async () => {
    const res = await post({ state: 'bogus' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_state');
    assert.match(res.body.message, /must be one of/);
  });

  it('rejects a derived state that the agent may not set itself', async () => {
    for (const state of ['minted', 'active']) {
      const res = await post({ state });
      assert.equal(res.status, 400, state);
      assert.equal(res.body.error, 'invalid_state', state);
    }
  });

  it('rejects a non-string state', async () => {
    const res = await post({ state: 42 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_state');
  });

  it('rejects a wallet key with a bad checksum, not just a bad shape', async () => {
    // 56 chars from the base32 alphabet, so a shape-only regex accepts
    // it. StrKey checks the Ed25519 checksum, which is what stops a
    // typo'd address from reaching the xlm-sender path.
    const res = await post({ wallet_public_key: `G${'A'.repeat(55)}` });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_wallet_public_key');
  });

  it('rejects a non-string wallet key', async () => {
    const res = await post({ wallet_public_key: 12345 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_wallet_public_key');
  });

  it('accepts an explicit null wallet key as a clear', async () => {
    // Absent means "leave the column alone"; null means "clear it".
    // The schema has to preserve that distinction.
    const res = await post({ wallet_public_key: null });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('rejects an object detail with invalid_detail', async () => {
    const res = await post({ detail: { msg: 'oops' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_detail');
  });

  it('rejects an empty body with nothing_to_update', async () => {
    const res = await post({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'nothing_to_update');
    assert.match(res.body.message, /at least one of/);
  });

  it('reports a field error before the nothing_to_update rule', async () => {
    // The cross-field check runs after the per-field ones, so a request
    // with exactly one — invalid — field names that field.
    const res = await post({ state: 'bogus' });
    assert.equal(res.body.error, 'invalid_state');
  });
});

describe('POST /v1/agent/claim — body validation contract', () => {
  beforeEach(() => resetDb());

  function post(body) {
    return request.post('/v1/agent/claim').send(body);
  }

  it('rejects a JSON array body with invalid_request', async () => {
    const res = await post([{ code: 'c402_x' }]);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  });

  it('rejects a missing code with missing_code', async () => {
    const res = await post({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_code');
  });

  it('rejects a non-string code with missing_code', async () => {
    const res = await post({ code: ['c402_x'] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_code');
  });

  it('rejects a whitespace-only code with missing_code', async () => {
    const res = await post({ code: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_code');
  });

  it('answers an unknown but well-formed code with the generic 401', async () => {
    // Shape and existence must be indistinguishable to an anonymous
    // caller past the "did you send a code at all" check.
    const res = await post({ code: 'not-a-real-code' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'invalid_claim');
  });
});

describe('GET /v1/policy/check — query validation contract', () => {
  /** @type {any} */ let key;

  beforeEach(async () => {
    resetDb();
    key = await createTestKey({ label: 'validation-policy' });
  });

  function get(qs) {
    return request.get(`/v1/policy/check${qs}`).set('X-Api-Key', key.key);
  }

  it('accepts a well-formed amount', async () => {
    const res = await get('?amount=5');
    assert.equal(res.status, 200);
    assert.ok('decision' in res.body);
  });

  it('accepts a two-decimal amount', async () => {
    const res = await get('?amount=5.25');
    assert.equal(res.status, 200);
  });

  for (const [label, qs] of [
    ['a missing amount', ''],
    ['an empty amount', '?amount='],
    ['a non-numeric amount', '?amount=abc'],
    ['a zero amount', '?amount=0'],
    ['a negative amount', '?amount=-5'],
  ]) {
    it(`rejects ${label} with invalid_amount`, async () => {
      const res = await get(qs);
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'invalid_amount');
    });
  }

  it('rejects trailing garbage that parseFloat would have accepted', async () => {
    // The old guard used isNaN(parseFloat(...)), which reads "10abc" as
    // 10 — so the preview answered a question about an amount POST
    // /v1/orders would have rejected outright.
    const res = await get('?amount=10abc');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_amount');
  });

  it('rejects sub-cent precision, matching POST /v1/orders', async () => {
    const res = await get('?amount=10.12345');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_amount');
  });

  it('takes the first value when the client repeats the parameter', async () => {
    const res = await get('?amount=5&amount=abc');
    assert.equal(res.status, 400, 'a repeated key parses as an array, which is not a valid amount');
    assert.equal(res.body.error, 'invalid_amount');
  });
});

// ── The operator surface ───────────────────────────────────────────────
//
// /dashboard sits behind session auth and a shared rate limiter, which is
// why it was the last surface still validating by hand. The reason it
// could not stay that way is src/policy.js: it fails CLOSED on a stored
// policy value it cannot parse, blocking every order the agent attempts.
// Its own comment says "policy is validated at storage time by
// dashboard.js so a malformed value in the DB is a bug" — and the guards
// these schemas replace were looser than that reader in three places, so
// the bug was reachable straight through the dashboard UI.
//
// Each `adds:` test below is one of those. They assert the write boundary
// now rejects exactly what the read boundary would later refuse to parse.

describe('/dashboard/api-keys — body validation contract', () => {
  /** @type {string} */ let auth;

  beforeEach(() => {
    resetDb();
    const { token, userId } = createTestSession({
      email: 'validation-owner@stellar_card.test',
      role: 'owner',
    });
    db.prepare(`INSERT INTO dashboards (id, user_id, name) VALUES (?, ?, ?)`).run(
      uuidv4(),
      userId,
      'Primary',
    );
    auth = `Bearer ${token}`;
  });

  /** Create a key and return its id, so PATCH has something to aim at. */
  async function seedKey() {
    const res = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'validation-target' });
    assert.equal(res.status, 201, 'seeding a key should succeed');
    return res.body.id;
  }

  function patch(id, body) {
    return request.patch(`/dashboard/api-keys/${id}`).set('Authorization', auth).send(body);
  }

  // ── The codes clients depend on ──────────────────────────────────────

  it('keeps invalid_spend_limit on create', async () => {
    const res = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ spend_limit_usdc: 'not-a-number' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_spend_limit');
  });

  it('keeps invalid_webhook_url for a non-HTTPS default_webhook_url', async () => {
    const res = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ default_webhook_url: 'http://insecure.example.com' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_webhook_url');
  });

  it('keeps invalid_wallet_public_key for a bad Stellar checksum', async () => {
    // Correct length and charset, wrong checksum — a shape-only regex
    // would have stored it.
    const res = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ wallet_public_key: `G${'A'.repeat(55)}` });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_wallet_public_key');
  });

  it('keeps invalid_policy on PATCH for every policy field', async () => {
    const id = await seedKey();
    for (const field of [
      'policy_daily_limit_usdc',
      'policy_single_tx_limit_usdc',
      'policy_require_approval_above_usdc',
      'policy_allowed_hours',
      'policy_allowed_days',
    ]) {
      const res = await patch(id, { [field]: 'definitely-not-valid' });
      assert.equal(res.status, 400, field);
      assert.equal(res.body.error, 'invalid_policy', field);
    }
  });

  it('keeps nothing_to_update for a PATCH that names no known field', async () => {
    const id = await seedKey();
    const res = await patch(id, { unrecognised_field: 'x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'nothing_to_update');
  });

  it('still 404s a PATCH against a key this dashboard does not own', async () => {
    const res = await patch(uuidv4(), { label: 'nope' });
    assert.equal(res.status, 404);
  });

  it('reports the first invalid field in declaration order', async () => {
    // Zod reports object issues in schema order and validate() surfaces
    // the first, which is what preserves the error a multiply-invalid
    // body used to get from the sequential guards.
    const id = await seedKey();
    const res = await patch(id, {
      spend_limit_usdc: 'bad',
      default_webhook_url: 'http://nope.example.com',
      policy_allowed_days: '[9]',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_spend_limit');
  });

  // ── Behaviour the schemas add ────────────────────────────────────────

  it('adds: rejects a policy amount parseFloat would silently truncate', async () => {
    // The old check was `isNaN(parseFloat(val))`. parseFloat('10abc') is
    // 10, so this passed and the raw string '10abc' was what got stored.
    const id = await seedKey();
    const res = await patch(id, { policy_daily_limit_usdc: '10abc' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_policy');
  });

  it('adds: rejects an out-of-range hour that policy.js would fail closed on', async () => {
    // The old check was the shape regex and nothing more, so hour 99
    // stored fine. policy.js range-checks 0-23 / 0-59 when it reads the
    // column back and throws, blocking every order with
    // policy_corrupt_hours.
    const id = await seedKey();
    for (const hours of [
      '{"start":"99:99","end":"17:00"}',
      '{"start":"09:00","end":"24:00"}',
      '{"start":"09:00","end":"09:60"}',
      '["09:00","17:00"]',
    ]) {
      const res = await patch(id, { policy_allowed_hours: hours });
      assert.equal(res.status, 400, hours);
      assert.equal(res.body.error, 'invalid_policy', hours);
    }
  });

  it('adds: rejects a non-integer allowed day that policy.js would fail closed on', async () => {
    // The old check was `d.some((n) => n < 0 || n > 6)`, and for a
    // non-number both comparisons are false — so every value here passed
    // the write boundary. policy.js requires Number.isInteger and throws,
    // blocking every order with policy_corrupt_days.
    const id = await seedKey();
    for (const days of ['["x"]', '[null]', '[1.5]', '[{}]', '[0,1,"Friday"]']) {
      const res = await patch(id, { policy_allowed_days: days });
      assert.equal(res.status, 400, days);
      assert.equal(res.body.error, 'invalid_policy', days);
    }
  });

  it('adds: rejects an oversized webhook URL before it costs a DNS lookup', async () => {
    // The handler's assertSafeUrl() resolves DNS. The cap runs in the
    // schema, so an unbounded URL never reaches it. Same cap the /v1
    // order surface applies to webhook_url.
    const res = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ default_webhook_url: `https://example.com/${'a'.repeat(2100)}` });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_webhook_url');
    assert.match(res.body.message, /at most 2048 characters/);
  });

  it('adds: rejects a non-object body instead of destructuring it', async () => {
    const res = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .set('Content-Type', 'application/json')
      .send('[1,2,3]');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_request');
  });

  // ── What is deliberately unchanged ───────────────────────────────────

  it('still accepts a valid policy on PATCH', async () => {
    const id = await seedKey();
    const res = await patch(id, {
      policy_daily_limit_usdc: '500.00',
      policy_single_tx_limit_usdc: '100',
      policy_allowed_hours: '{"start":"09:00","end":"17:00"}',
      policy_allowed_days: '[1,2,3,4,5]',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it('still treats an empty string as "clear this column", not as invalid', async () => {
    const id = await seedKey();
    const res = await patch(id, { policy_allowed_days: '', default_webhook_url: '' });
    assert.equal(res.status, 200);
  });

  it('still drops the policy_* fields a create sends, rather than rejecting them', async () => {
    // POST does not persist the policy columns and never validated them.
    // Turning that into a 400 is a contract change and is not part of
    // this one — pinned so it stays a decision rather than a surprise.
    const res = await request
      .post('/dashboard/api-keys')
      .set('Authorization', auth)
      .send({ label: 'create-with-policy', policy_allowed_days: 'garbage' });
    assert.equal(res.status, 201);
  });
});

describe('/dashboard/alert-rules — notification target validation', () => {
  /** @type {string} */ let auth;

  beforeEach(() => {
    resetDb();
    const { token, userId } = createTestSession({
      email: 'alert-owner@stellar_card.test',
      role: 'owner',
    });
    db.prepare(`INSERT INTO dashboards (id, user_id, name) VALUES (?, ?, ?)`).run(
      uuidv4(),
      userId,
      'Primary',
    );
    auth = `Bearer ${token}`;
  });

  function create(body) {
    return request.post('/dashboard/alert-rules').set('Authorization', auth).send(body);
  }

  // notify_email and notify_webhook_url had no validation anywhere:
  // createRule/updateRule bind them straight into the statement, so a
  // non-string reached better-sqlite3 as an unbindable value and came
  // back as the driver's own TypeError text.
  it('adds: rejects a non-string notify_email', async () => {
    const res = await create({ name: 'r', kind: 'failure_rate_high', notify_email: {} });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_rule');
  });

  it('adds: rejects a notify_email that is not an address', async () => {
    const res = await create({ name: 'r', kind: 'failure_rate_high', notify_email: 'nope' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_rule');
  });

  it('adds: rejects a non-HTTPS notify_webhook_url', async () => {
    const res = await create({
      name: 'r',
      kind: 'failure_rate_high',
      notify_webhook_url: 'http://insecure.example.com',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_rule');
  });

  it('adds: rejects a snoozedUntil that is not a timestamp', async () => {
    // Stored fine before, and the evaluator compares the column against
    // a timestamp — so the rule ended up either permanently snoozed or
    // never snoozed, with nothing to say which.
    const created = await create({ name: 'snoozy', kind: 'failure_rate_high' });
    assert.equal(created.status, 201);
    const res = await request
      .patch(`/dashboard/alert-rules/${created.body.rule.id}`)
      .set('Authorization', auth)
      .send({ snoozedUntil: 'tomorrow-ish' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'update_failed');
  });

  it('keeps missing_fields when name or kind is absent', async () => {
    for (const body of [{ kind: 'failure_rate_high' }, { name: 'r' }]) {
      const res = await create(body);
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'missing_fields');
    }
  });

  it('still accepts a rule with valid notification targets', async () => {
    const res = await create({
      name: 'valid-rule',
      kind: 'failure_rate_high',
      notify_email: 'ops@example.com',
      notify_webhook_url: 'https://hooks.example.com/alert',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.rule.notify_email, 'ops@example.com');
  });

  it('still accepts absent and null notification targets', async () => {
    const res = await create({
      name: 'no-targets',
      kind: 'failure_rate_high',
      notify_email: null,
    });
    assert.equal(res.status, 201);
  });
});

describe('POST /dashboard/webhook-deliveries/test — url validation', () => {
  /** @type {string} */ let auth;

  beforeEach(() => {
    resetDb();
    const { token, userId } = createTestSession({
      email: 'webhook-owner@stellar_card.test',
      role: 'owner',
    });
    db.prepare(`INSERT INTO dashboards (id, user_id, name) VALUES (?, ?, ?)`).run(
      uuidv4(),
      userId,
      'Primary',
    );
    auth = `Bearer ${token}`;
  });

  function post(body) {
    return request.post('/dashboard/webhook-deliveries/test').set('Authorization', auth).send(body);
  }

  it('keeps missing_url for an absent url', async () => {
    const res = await post({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'missing_url');
  });

  it('adds: answers 400 rather than 502 for a malformed url', async () => {
    // `url` was checked for truthiness only, so anything else went to
    // fireWebhook → assertSafeUrl and surfaced as `502 delivery_failed`
    // — the status class for "your endpoint is broken", not "your
    // request is".
    for (const url of ['not-a-url', 42, { href: 'https://example.com' }]) {
      const res = await post({ url });
      assert.equal(res.status, 400, String(url));
      assert.equal(res.body.error, 'invalid_url', String(url));
    }
  });

  it('adds: rejects an oversized url before it costs a DNS lookup', async () => {
    const res = await post({ url: `https://example.com/${'a'.repeat(2100)}` });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_url');
  });

  it('adds: rejects a non-string webhook_secret', async () => {
    const res = await post({ url: 'https://example.com/hook', webhook_secret: {} });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'invalid_webhook_secret');
  });
});
