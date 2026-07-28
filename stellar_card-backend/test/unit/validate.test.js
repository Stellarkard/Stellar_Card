// Unit tests for lib/validate.js — the Zod-backed request validation
// middleware and its shared field primitives.
//
// The middleware is exercised directly against fake req/res objects
// rather than through supertest: these tests are about the middleware's
// own contract (which error code, which message, what it writes back
// onto the request), and a real HTTP round-trip would only add rate
// limiters and auth to the things that can go wrong. The route-level
// behaviour is covered by the integration suite.

require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');

const {
  validate,
  patternString,
  boundedString,
  jsonObject,
  boundedIntQuery,
  optionalIsoTimestamp,
  NON_OBJECT_BODY_MESSAGE,
} = require('../../src/lib/validate');

// ── Test doubles ───────────────────────────────────────────────────────────

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

/**
 * Run a middleware against a request shape and report what happened.
 * @returns {{ nextCalled: boolean, res: any, req: any }}
 */
function run(middleware, req) {
  const res = fakeRes();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, res, req };
}

// ── Body shape guard ───────────────────────────────────────────────────────

describe('validate — body shape guard', () => {
  const middleware = validate({ body: z.object({ a: z.unknown() }).passthrough() });

  for (const [label, body] of [
    ['undefined (no Content-Type, empty body, text/plain)', undefined],
    ['null', null],
    ['an array', [1, 2, 3]],
    ['a bare string', 'hello'],
    ['a number', 42],
  ]) {
    it(`rejects a body that is ${label}`, () => {
      const { nextCalled, res } = run(middleware, { body });
      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'invalid_request');
      assert.equal(res.body.message, NON_OBJECT_BODY_MESSAGE);
    });
  }

  it('accepts an empty object when the schema allows it', () => {
    const permissive = validate({ body: z.object({}).passthrough() });
    const { nextCalled, res } = run(permissive, { body: {} });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });
});

// ── Error code mapping ─────────────────────────────────────────────────────

describe('validate — error code mapping', () => {
  const schema = z
    .object({
      amount_usdc: patternString(/^\d+$/, 'amount must be digits'),
      webhook_url: boundedString(10, 'url must be a string', 'url too long').optional(),
    })
    .passthrough();

  const middleware = validate({
    body: schema,
    errorCodes: { amount_usdc: 'invalid_amount', webhook_url: 'invalid_webhook_url' },
  });

  it('maps a failing field to its declared error code', () => {
    const { res } = run(middleware, { body: { amount_usdc: 'abc' } });
    assert.equal(res.body.error, 'invalid_amount');
    assert.equal(res.body.message, 'amount must be digits');
  });

  it('maps a different field to a different code', () => {
    const { res } = run(middleware, { body: { amount_usdc: '10', webhook_url: 42 } });
    assert.equal(res.body.error, 'invalid_webhook_url');
    assert.equal(res.body.message, 'url must be a string');
  });

  it('falls back to invalid_request for an unmapped field', () => {
    const unmapped = validate({
      body: z.object({ other: patternString(/^x$/, 'must be x') }).passthrough(),
    });
    const { res } = run(unmapped, { body: { other: 'y' } });
    assert.equal(res.body.error, 'invalid_request');
  });

  it('honours a custom defaultErrorCode for every unmapped field', () => {
    const custom = validate({
      body: z
        .object({
          email: patternString(/^.+$/, 'email and code are required strings.'),
          code: patternString(/^.+$/, 'email and code are required strings.'),
        })
        .passthrough(),
      defaultErrorCode: 'missing_fields',
    });
    for (const body of [{ code: 'x' }, { email: 'a@b.c' }]) {
      const { res } = run(custom, { body });
      assert.equal(res.body.error, 'missing_fields');
      assert.equal(res.body.message, 'email and code are required strings.');
    }
  });

  it('reports the first failing field in schema-declaration order', () => {
    // The hand-written guards this replaces validated top-down and
    // returned on the first failure. A request that is invalid in
    // several ways must still receive the same error it always did.
    const { res } = run(middleware, { body: { amount_usdc: 'abc', webhook_url: 42 } });
    assert.equal(res.body.error, 'invalid_amount');
  });
});

// ── Non-transformation guarantee ───────────────────────────────────────────

describe('validate — leaves the request body intact', () => {
  it('passes unknown keys through untouched', () => {
    // POST /v1/orders hashes the raw body for its idempotency
    // fingerprint. A schema that stripped unknown keys would silently
    // change which retries count as identical requests.
    const middleware = validate({
      body: z.object({ amount_usdc: patternString(/^\d+$/, 'digits') }).passthrough(),
    });
    const body = { amount_usdc: '10', future_field: { nested: true }, note: 'hello' };
    const { nextCalled, req } = run(middleware, { body });
    assert.equal(nextCalled, true);
    assert.deepEqual(req.body, body);
  });

  it('does not coerce values it validates', () => {
    const middleware = validate({
      body: z.object({ amount_usdc: patternString(/^\d+(\.\d+)?$/, 'digits') }).passthrough(),
    });
    const { req } = run(middleware, { body: { amount_usdc: '10.00' } });
    // Still the original string — "10.00" must not become the number 10,
    // which would lose the cents and change the stored amount.
    assert.equal(req.body.amount_usdc, '10.00');
    assert.equal(typeof req.body.amount_usdc, 'string');
  });
});

// ── Query validation ───────────────────────────────────────────────────────

describe('validate — query', () => {
  const middleware = validate({
    query: z
      .object({
        limit: boundedIntQuery({ default: 20, min: 1, max: 200 }),
        offset: boundedIntQuery({ default: 0, min: 0, max: 1000 }),
        since: optionalIsoTimestamp('since must be an ISO-8601 timestamp'),
      })
      .passthrough(),
    errorCodes: { since: 'invalid_since' },
  });

  it('applies defaults when the query is empty', () => {
    const { nextCalled, req } = run(middleware, { query: {} });
    assert.equal(nextCalled, true);
    assert.equal(req.query.limit, 20);
    assert.equal(req.query.offset, 0);
    assert.equal(req.query.since, undefined);
  });

  it('tolerates a completely absent query object', () => {
    const { nextCalled, req } = run(middleware, {});
    assert.equal(nextCalled, true);
    assert.equal(req.query.limit, 20);
  });

  it('clamps an over-large limit to the maximum', () => {
    const { req } = run(middleware, { query: { limit: '99999' } });
    assert.equal(req.query.limit, 200);
  });

  it('clamps a negative offset to the minimum', () => {
    const { req } = run(middleware, { query: { offset: '-5' } });
    assert.equal(req.query.offset, 0);
  });

  it('falls back to the default for an unparseable integer', () => {
    // Matches the pre-existing `parseInt(...) || fallback` behaviour
    // clients already depend on — the clamp is what protects the DB.
    for (const limit of ['abc', '', 'NaN']) {
      const { req } = run(middleware, { query: { limit } });
      assert.equal(req.query.limit, 20, limit);
    }
  });

  it('takes the first value when a query key is repeated', () => {
    // Express turns ?limit=5&limit=9 into an array.
    const { req } = run(middleware, { query: { limit: ['5', '9'] } });
    assert.equal(req.query.limit, 5);
  });

  it('rejects a malformed timestamp with its mapped code', () => {
    const { nextCalled, res } = run(middleware, { query: { since: 'yesterday' } });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_since');
  });

  it('accepts a well-formed ISO timestamp', () => {
    const { nextCalled, req } = run(middleware, { query: { since: '2026-04-16T00:00:00.000Z' } });
    assert.equal(nextCalled, true);
    assert.equal(req.query.since, '2026-04-16T00:00:00.000Z');
  });

  it('treats an empty timestamp as absent rather than malformed', () => {
    const { nextCalled, req } = run(middleware, { query: { since: '' } });
    assert.equal(nextCalled, true);
    assert.equal(req.query.since, undefined);
  });

  it('overwrites req.query even though it is a prototype accessor', () => {
    // Express defines `query` as a getter on the request prototype;
    // writing the validated value back has to shadow it with an own
    // property or the handler keeps reading the raw strings.
    const proto = {
      get query() {
        return { limit: '7' };
      },
    };
    const req = Object.create(proto);
    const { nextCalled } = run(middleware, req);
    assert.equal(nextCalled, true);
    assert.equal(req.query.limit, 7);
  });
});

// ── Params validation ──────────────────────────────────────────────────────

describe('validate — params', () => {
  const middleware = validate({
    params: z.object({ id: patternString(/^[0-9a-f-]{36}$/, 'id must be a UUID') }).passthrough(),
    errorCodes: { id: 'invalid_order_id' },
  });

  it('accepts a well-formed param', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const { nextCalled, req } = run(middleware, { params: { id } });
    assert.equal(nextCalled, true);
    assert.equal(req.params.id, id);
  });

  it('rejects a malformed param with its mapped code', () => {
    const { nextCalled, res } = run(middleware, { params: { id: '../../etc/passwd' } });
    assert.equal(nextCalled, false);
    assert.equal(res.body.error, 'invalid_order_id');
  });
});

// ── Field primitives ───────────────────────────────────────────────────────

describe('patternString', () => {
  const schema = z.object({ v: patternString(/^\d+$/, 'must be digits') });

  it('accepts a matching string', () => {
    assert.equal(schema.safeParse({ v: '123' }).success, true);
  });

  it('rejects a non-string with the field message, not a Zod type error', () => {
    // `z.string()` would emit "Expected string, received number", which
    // is not the wording the API contract promises.
    const result = schema.safeParse({ v: 123 });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'must be digits');
  });

  it('rejects null, undefined, arrays, and objects', () => {
    for (const v of [null, undefined, ['1'], { n: 1 }]) {
      assert.equal(schema.safeParse({ v }).success, false, JSON.stringify(v));
    }
  });

  it('optionally trims before matching', () => {
    const trimming = z.object({ v: patternString(/^\d+$/, 'digits', { trim: true }) });
    assert.equal(trimming.safeParse({ v: '  42  ' }).success, true);
    assert.equal(schema.safeParse({ v: '  42  ' }).success, false);
  });

  it('preserves the untrimmed original value', () => {
    const trimming = z.object({ v: patternString(/^\d+$/, 'digits', { trim: true }) });
    assert.equal(trimming.parse({ v: ' 42 ' }).v, ' 42 ');
  });
});

describe('boundedString', () => {
  const schema = z.object({ v: boundedString(5, 'must be a string', 'too long') });

  it('accepts a string within the cap', () => {
    assert.equal(schema.safeParse({ v: 'abcde' }).success, true);
  });

  it('accepts an empty string', () => {
    assert.equal(schema.safeParse({ v: '' }).success, true);
  });

  it('distinguishes the type error from the length error', () => {
    assert.equal(schema.safeParse({ v: 42 }).error.issues[0].message, 'must be a string');
    assert.equal(schema.safeParse({ v: 'abcdef' }).error.issues[0].message, 'too long');
  });
});

describe('jsonObject', () => {
  const schema = z.object({
    v: jsonObject(64, 'must be an object', 'could not be serialized', 'too big'),
  });

  it('accepts a plain object within the byte budget', () => {
    assert.equal(schema.safeParse({ v: { a: 1 } }).success, true);
  });

  it('rejects arrays and null, which are both typeof object', () => {
    assert.equal(schema.safeParse({ v: [] }).error.issues[0].message, 'must be an object');
    assert.equal(schema.safeParse({ v: null }).error.issues[0].message, 'must be an object');
  });

  it('rejects a primitive', () => {
    assert.equal(schema.safeParse({ v: 'text' }).error.issues[0].message, 'must be an object');
  });

  it('rejects a payload over the byte budget', () => {
    assert.equal(
      schema.safeParse({ v: { a: 'x'.repeat(100) } }).error.issues[0].message,
      'too big',
    );
  });

  it('measures bytes, not characters', () => {
    // 30 multi-byte characters are well under a 64-character budget but
    // over a 64-byte one. The DB column is sized in bytes.
    const result = schema.safeParse({ v: { a: 'é'.repeat(30) } });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'too big');
  });

  it('rejects a circular object as a 400 rather than letting it throw', () => {
    /** @type {any} */ const circular = { name: 'loop' };
    circular.self = circular;
    const result = schema.safeParse({ v: circular });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'could not be serialized');
  });

  it('rejects an object with a throwing toJSON', () => {
    const hostile = {
      toJSON() {
        throw new Error('nope');
      },
    };
    assert.equal(
      schema.safeParse({ v: hostile }).error.issues[0].message,
      'could not be serialized',
    );
  });

  it('rejects a value JSON.stringify cannot represent', () => {
    const result = schema.safeParse({ v: { toJSON: () => undefined } });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'could not be serialized');
  });

  it('rejects a BigInt payload as unserialisable rather than throwing', () => {
    const result = schema.safeParse({ v: { n: BigInt(1) } });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'could not be serialized');
  });
});
