// Unit tests for src/lib/validate.js — the request-validation middleware
// and the field primitives every route schema is built from.
//
// No DB or HTTP server: validate() only touches req.body / req.query /
// req.params, res.status().json(), and next(), so it is exercised directly
// against mock objects. The route-level contract (which `error` code each
// endpoint actually returns over the wire) lives in
// test/integration/request-validation.test.js.
//
// The properties worth pinning here are the ones that are invisible in a
// passing 200 and only surface as a wrong error code or a silently
// rewritten request:
//
//   - the path → error-code mapping, including the fallback
//   - first-issue-wins, which is what preserves the ordering of the
//     sequential `if` guards these schemas replaced
//   - the non-transformation guarantee for bodies (POST /v1/orders hashes
//     the raw body for idempotency)
//   - query coercion and clamping, which is the one place coercion is
//     deliberate
//   - the hostile-payload paths through jsonObject

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

function mockRes() {
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

/** Run a middleware and report whether it passed or short-circuited. */
function run(middleware, req) {
  const res = mockRes();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

describe('validate() — body shape guard', () => {
  const middleware = validate({
    body: z.object({ email: patternString(EMAIL_SHAPE, 'bad email') }).passthrough(),
    errorCodes: { email: 'invalid_email' },
  });

  // Every one of these used to reach the route's `const { email } =
  // req.body` destructure and surface as a 500.
  for (const [label, body] of [
    ['an undefined body (no Content-Type)', undefined],
    ['a null body', null],
    ['an array body', [{ email: 'a@b.com' }]],
    ['a string body', 'not-an-object'],
  ]) {
    it(`rejects ${label} with invalid_request before the schema runs`, () => {
      const { res, nextCalled } = run(middleware, { body });
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, 'invalid_request');
      assert.equal(res.body.message, NON_OBJECT_BODY_MESSAGE);
      assert.equal(nextCalled, false);
    });
  }

  it('names the body problem rather than listing every required field', () => {
    // A schema failure would report "bad email"; the shape guard must win
    // so the caller is told the actual problem.
    const { res } = run(middleware, { body: [] });
    assert.notEqual(res.body.message, 'bad email');
  });
});

describe('validate() — error-code mapping', () => {
  const middleware = validate({
    body: z
      .object({
        amount: patternString(/^\d+$/, 'amount must be digits'),
        note: boundedString(4, 'note must be a string', 'note is too long'),
        extra: z.unknown().optional(),
      })
      .passthrough(),
    errorCodes: { amount: 'invalid_amount', note: 'invalid_note' },
  });

  it('maps a failing field to its declared error code', () => {
    const { res } = run(middleware, { body: { amount: 'abc', note: 'ok' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_amount');
    assert.equal(res.body.message, 'amount must be digits');
  });

  it('maps a different field to its own code', () => {
    const { res } = run(middleware, { body: { amount: '10', note: 'far too long' } });
    assert.equal(res.body.error, 'invalid_note');
    assert.equal(res.body.message, 'note is too long');
  });

  it('reports the first issue in schema-declaration order when several fail', () => {
    // This is what preserves which error a multiply-invalid request gets:
    // the guards these schemas replaced were sequential `if` statements,
    // so the first declared field has to win.
    const { res } = run(middleware, { body: { amount: 'abc', note: 'far too long' } });
    assert.equal(res.body.error, 'invalid_amount');
  });

  it('falls back to invalid_request for a field with no mapping', () => {
    const withUnmapped = validate({
      body: z.object({ other: patternString(/^x$/, 'must be x') }).passthrough(),
      errorCodes: { amount: 'invalid_amount' },
    });
    const { res } = run(withUnmapped, { body: { other: 'y' } });
    assert.equal(res.body.error, 'invalid_request');
  });

  it('honours a custom defaultErrorCode', () => {
    const withDefault = validate({
      body: z.object({ other: patternString(/^x$/, 'must be x') }).passthrough(),
      defaultErrorCode: 'validation_failed',
    });
    const { res } = run(withDefault, { body: { other: 'y' } });
    assert.equal(res.body.error, 'validation_failed');
  });

  it('keys the code on the first path segment for a nested field', () => {
    const nested = validate({
      body: z.object({ metadata: z.object({ name: z.string('name must be a string') }) }),
      errorCodes: { metadata: 'invalid_metadata' },
    });
    const { res } = run(nested, { body: { metadata: { name: 42 } } });
    assert.equal(res.body.error, 'invalid_metadata');
  });
});

describe('validate() — the non-transformation guarantee', () => {
  // POST /v1/orders hashes the raw request body to build its idempotency
  // fingerprint. A schema that stripped unknown keys or coerced a value
  // would silently change which retries count as identical.
  const middleware = validate({
    body: z.object({ amount_usdc: patternString(/^\d+(\.\d{1,2})?$/, 'bad amount') }).passthrough(),
  });

  it('leaves a valid body byte-identical', () => {
    const req = { body: { amount_usdc: '10.00' } };
    const { nextCalled } = run(middleware, req);
    assert.equal(nextCalled, true);
    assert.deepEqual(req.body, { amount_usdc: '10.00' });
    assert.equal(typeof req.body.amount_usdc, 'string', 'must not coerce to a number');
  });

  it('preserves forward-compatible keys the schema does not declare', () => {
    const req = { body: { amount_usdc: '10.00', future_field: { nested: true } } };
    run(middleware, req);
    assert.deepEqual(req.body.future_field, { nested: true });
  });

  it('does not trim a value that patternString only trims for the test', () => {
    // `{ trim: true }` affects what the pattern is tested against, not
    // what the handler receives — normalisation stays the handler's job.
    const trimming = validate({
      body: z
        .object({ email: patternString(EMAIL_SHAPE, 'bad email', { trim: true }) })
        .passthrough(),
    });
    const req = { body: { email: '  a@b.com  ' } };
    const { nextCalled } = run(trimming, req);
    assert.equal(nextCalled, true);
    assert.equal(req.body.email, '  a@b.com  ');
  });
});

describe('validate() — query and params', () => {
  const middleware = validate({
    query: z.object({
      status: z
        .enum(['delivered', 'failed'], 'status must be one of: delivered, failed')
        .optional(),
      limit: boundedIntQuery({ default: 50, min: 1, max: 100 }),
    }),
    errorCodes: { status: 'invalid_status' },
  });

  it('writes the coerced query back onto the request', () => {
    const req = { query: { limit: '10' } };
    const { nextCalled } = run(middleware, req);
    assert.equal(nextCalled, true);
    assert.equal(req.query.limit, 10);
  });

  it('tolerates a request with no query object at all', () => {
    const req = {};
    const { nextCalled } = run(middleware, req);
    assert.equal(nextCalled, true);
    assert.equal(req.query.limit, 50);
  });

  it('maps a query failure to its error code', () => {
    const { res } = run(middleware, { query: { status: 'delivred' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_status');
  });

  it('validates params the same way', () => {
    const byParams = validate({
      params: z.object({ id: patternString(/^[a-f0-9-]{36}$/, 'id must be a uuid') }),
      errorCodes: { id: 'invalid_id' },
    });
    const { res } = run(byParams, { params: { id: 'nope' } });
    assert.equal(res.body.error, 'invalid_id');
  });

  it('checks body before query, so a bad body is reported first', () => {
    const both = validate({
      body: z.object({ a: patternString(/^1$/, 'a must be 1') }).passthrough(),
      query: z.object({ b: patternString(/^2$/, 'b must be 2') }),
      errorCodes: { a: 'invalid_a', b: 'invalid_b' },
    });
    const { res } = run(both, { body: { a: 'x' }, query: { b: 'y' } });
    assert.equal(res.body.error, 'invalid_a');
  });
});

describe('patternString', () => {
  const middleware = validate({
    body: z
      .object({ email: patternString(EMAIL_SHAPE, 'bad email', { trim: true }) })
      .passthrough(),
    errorCodes: { email: 'invalid_email' },
  });

  it('emits the field message for a non-string, not Zod’s "Expected string"', () => {
    for (const email of [42, ['a@b.com'], null, {}, true]) {
      const { res } = run(middleware, { body: { email } });
      assert.equal(res.body.error, 'invalid_email');
      assert.equal(res.body.message, 'bad email', JSON.stringify(email));
    }
  });

  it('emits the field message for a missing key', () => {
    const { res } = run(middleware, { body: {} });
    assert.equal(res.body.error, 'invalid_email');
    assert.equal(res.body.message, 'bad email');
  });

  it('tests the trimmed form when { trim: true }', () => {
    const { nextCalled } = run(middleware, { body: { email: '  a@b.com  ' } });
    assert.equal(nextCalled, true);
  });

  it('tests the raw form by default', () => {
    const strict = validate({
      body: z.object({ email: patternString(EMAIL_SHAPE, 'bad email') }).passthrough(),
    });
    const { res } = run(strict, { body: { email: '  a@b.com  ' } });
    assert.equal(res.statusCode, 400);
  });
});

describe('boundedString', () => {
  const middleware = validate({
    body: z
      .object({ url: boundedString(10, 'url must be a string', 'url is too long') })
      .passthrough(),
    errorCodes: { url: 'invalid_url' },
  });

  it('distinguishes the type failure from the length failure', () => {
    const wrongType = run(middleware, { body: { url: 42 } });
    assert.equal(wrongType.res.body.message, 'url must be a string');

    const tooLong = run(middleware, { body: { url: 'x'.repeat(11) } });
    assert.equal(tooLong.res.body.message, 'url is too long');
  });

  it('accepts a string exactly at the cap', () => {
    const { nextCalled } = run(middleware, { body: { url: 'x'.repeat(10) } });
    assert.equal(nextCalled, true);
  });

  it('accepts the empty string — length is the only bound it applies', () => {
    const { nextCalled } = run(middleware, { body: { url: '' } });
    assert.equal(nextCalled, true);
  });
});

describe('jsonObject', () => {
  const middleware = validate({
    body: z
      .object({
        metadata: jsonObject(
          64,
          'metadata must be an object',
          'metadata is not serialisable',
          'metadata is too large',
        ),
      })
      .passthrough(),
    errorCodes: { metadata: 'invalid_metadata' },
  });

  it('rejects the three things that are typeof "object" but not maps', () => {
    for (const metadata of [null, [1, 2, 3], []]) {
      const { res } = run(middleware, { body: { metadata } });
      assert.equal(res.body.message, 'metadata must be an object', JSON.stringify(metadata));
    }
  });

  it('rejects a primitive', () => {
    const { res } = run(middleware, { body: { metadata: 'not-an-object' } });
    assert.equal(res.body.message, 'metadata must be an object');
  });

  it('rejects a circular reference as a 400 rather than letting it 500 at the storage site', () => {
    const metadata = { name: 'loop' };
    metadata.self = metadata;
    const { res } = run(middleware, { body: { metadata } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'metadata is not serialisable');
  });

  it('rejects a throwing toJSON', () => {
    const metadata = {
      toJSON() {
        throw new Error('nope');
      },
    };
    const { res } = run(middleware, { body: { metadata } });
    assert.equal(res.body.message, 'metadata is not serialisable');
  });

  it('rejects a BigInt value, which JSON.stringify throws on', () => {
    const { res } = run(middleware, { body: { metadata: { n: BigInt(1) } } });
    assert.equal(res.body.message, 'metadata is not serialisable');
  });

  it('measures bytes, not characters', () => {
    // 30 multi-byte characters are under a 64-CHARACTER budget but over a
    // 64-BYTE one, which is what the column actually costs.
    const multiByte = { k: '€'.repeat(30) };
    assert.ok(JSON.stringify(multiByte).length < 64, 'precondition: under the character budget');
    const { res } = run(middleware, { body: { metadata: multiByte } });
    assert.equal(res.body.message, 'metadata is too large');
  });

  it('accepts a small plain object unchanged', () => {
    const req = { body: { metadata: { order: 'abc' } } };
    const { nextCalled } = run(middleware, req);
    assert.equal(nextCalled, true);
    assert.deepEqual(req.body.metadata, { order: 'abc' });
  });
});

describe('boundedIntQuery', () => {
  const middleware = validate({
    query: z.object({ limit: boundedIntQuery({ default: 50, min: 1, max: 100 }) }),
  });

  function limitFor(query) {
    const req = { query };
    run(middleware, req);
    return req.query.limit;
  }

  it('clamps rather than erroring, because the clamp is what protects the database', () => {
    assert.equal(limitFor({ limit: '99999' }), 100);
    assert.equal(limitFor({ limit: '0' }), 1);
    assert.equal(limitFor({ limit: '-10' }), 1);
  });

  it('falls back to the default for values clients already send', () => {
    assert.equal(limitFor({}), 50);
    assert.equal(limitFor({ limit: '' }), 50);
    assert.equal(limitFor({ limit: 'abc' }), 50);
  });

  it('takes the first value when the client repeats the key', () => {
    // Express parses ?limit=10&limit=20 into an array.
    assert.equal(limitFor({ limit: ['10', '20'] }), 10);
  });

  it('truncates a float rather than storing a fractional LIMIT', () => {
    assert.equal(limitFor({ limit: '10.9' }), 10);
  });
});

describe('optionalIsoTimestamp', () => {
  const middleware = validate({
    query: z.object({ since: optionalIsoTimestamp('since must be an ISO-8601 timestamp') }),
    errorCodes: { since: 'invalid_since' },
  });

  it('rejects a bound Date.parse cannot read', () => {
    // These are compared lexically against an ISO column, so a malformed
    // bound silently matches everything or nothing — which reads to the
    // caller as data loss rather than as a bad filter.
    for (const since of ['yesterday', 'not-a-date', '2026-13-45']) {
      const { res } = run(middleware, { query: { since } });
      assert.equal(res.statusCode, 400, since);
      assert.equal(res.body.error, 'invalid_since', since);
    }
  });

  it('accepts a well-formed timestamp and passes it through as a string', () => {
    const req = { query: { since: '2026-01-01T00:00:00.000Z' } };
    const { nextCalled } = run(middleware, req);
    assert.equal(nextCalled, true);
    assert.equal(req.query.since, '2026-01-01T00:00:00.000Z');
  });

  it('normalises absent, empty, and null to undefined so the query builder skips the clause', () => {
    for (const query of [{}, { since: '' }, { since: null }]) {
      const req = { query };
      const { nextCalled } = run(middleware, req);
      assert.equal(nextCalled, true, JSON.stringify(query));
      assert.equal(req.query.since, undefined, JSON.stringify(query));
    }
  });

  it('rejects a non-string bound', () => {
    const { res } = run(middleware, { query: { since: 12345 } });
    assert.equal(res.body.error, 'invalid_since');
  });
});
