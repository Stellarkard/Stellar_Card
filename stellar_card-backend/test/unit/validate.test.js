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
const { Keypair } = require('@stellar/stellar-sdk');

const {
  validate,
  patternString,
  boundedString,
  stellarPublicKey,
  jsonObject,
  boundedIntQuery,
  optionalIsoTimestamp,
  orderIdParam,
  FulfillmentCard,
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

describe('stellarPublicKey', () => {
  const required = z.object({ v: stellarPublicKey('must be a valid G-address') });
  const clears = z.object({
    v: stellarPublicKey('must be a valid G-address').nullable().optional(),
  });

  it('accepts a Stellar G-address generated by the SDK', () => {
    const address = Keypair.random().publicKey();
    assert.equal(required.safeParse({ v: address }).success, true);
  });

  it('rejects a 56-char string with the right shape but a wrong checksum', () => {
    // The retired regex /^G[A-Z2-7]{55}$/ accepted this; StrKey's
    // checksum check is the whole point of the primitive.
    const result = required.safeParse({ v: 'G' + 'A'.repeat(55) });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'must be a valid G-address');
  });

  it('rejects non-strings, including the null/absent the caller did not opt into', () => {
    for (const v of [12345, ['G…'], { address: 'G…' }, null, undefined]) {
      assert.equal(required.safeParse({ v }).success, false, JSON.stringify(v));
    }
  });

  it('treats null and absence as explicit clears when the field opts in', () => {
    // agent/status maps a present-but-null wallet to a DB null ("clear
    // it", distinct from absent = "don't touch it"). The primitive itself
    // stays strict; the caller decides which inputs mean "unset" via
    // .nullable().optional().
    assert.equal(clears.safeParse({}).success, true);
    assert.equal(clears.safeParse({ v: null }).success, true);
  });
});

describe('boundedString as a nullable optional field', () => {
  const schema = z.object({
    detail: boundedString(5, 'must be a string or null', 'too long').nullable().optional(),
  });

  it('accepts absence, null, and in-range strings', () => {
    for (const obj of [{}, { detail: null }, { detail: 'abc' }]) {
      assert.equal(schema.safeParse(obj).success, true, JSON.stringify(obj));
    }
  });

  it('rejects an over-length string with the length message', () => {
    const result = schema.safeParse({ detail: 'abcdef' });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'too long');
  });

  it('still rejects a non-string object', () => {
    const result = schema.safeParse({ detail: { n: 1 } });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'must be a string or null');
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

describe('boundedIntQuery', () => {
  const schema = z.object({
    limit: boundedIntQuery({ default: 20, min: 1, max: 200 }),
  });

  it('passes an in-range integer straight through', () => {
    assert.equal(schema.parse({ limit: '50' }).limit, 50);
  });

  it('already-typed numbers are accepted too', () => {
    // A hand-rolled caller (or a future Express config that parses the
    // query) may hand us a number rather than a string.
    assert.equal(schema.parse({ limit: 50 }).limit, 50);
  });

  it('applies the default when the key is absent or null', () => {
    for (const obj of [{}, { limit: undefined }, { limit: null }]) {
      assert.equal(schema.parse(obj).limit, 20, JSON.stringify(obj));
    }
  });

  it('treats an empty string as absent rather than as zero', () => {
    // `?limit=` is a client that sent the key with no value. parseInt('')
    // is NaN, which the `|| fallback` this replaces also resolved to the
    // default — but the clamp would have turned a parsed 0 into 1.
    assert.equal(schema.parse({ limit: '' }).limit, 20);
  });

  it('clamps into range on both ends', () => {
    assert.equal(schema.parse({ limit: '0' }).limit, 1);
    assert.equal(schema.parse({ limit: '-10' }).limit, 1);
    assert.equal(schema.parse({ limit: '100000' }).limit, 200);
  });

  it('falls back to the default for values that are not numbers at all', () => {
    for (const limit of ['abc', 'NaN', 'Infinity', {}, []]) {
      assert.equal(schema.parse({ limit }).limit, 20, JSON.stringify(limit));
    }
  });

  it('accepts a parseInt-style numeric prefix', () => {
    // parseInt('1e') is 1 and parseInt('12abc') is 12. That is the
    // long-standing `parseInt(x, 10) || fallback` behaviour this
    // replaces, kept deliberately: a client sending "12abc" was already
    // treated as 12 before, and silently changing it to the default
    // would be a wire-contract change for no security benefit. The clamp
    // is what bounds the query, not the strictness of the parse.
    assert.equal(schema.parse({ limit: '1e' }).limit, 1);
    assert.equal(schema.parse({ limit: '12abc' }).limit, 12);
  });

  it('truncates a decimal rather than rounding it', () => {
    // parseInt('3.9') is 3. The previous inline `parseInt(...) || 20`
    // behaved identically; the contract is not "round", it is "truncate".
    assert.equal(schema.parse({ limit: '3.9' }).limit, 3);
  });
});

describe('optionalIsoTimestamp', () => {
  const schema = z.object({ since: optionalIsoTimestamp('bad timestamp') });

  it('keeps a well-formed timestamp byte-identical', () => {
    // These values are compared lexically against created_at, so the
    // middleware must not reformat them into a different shape.
    const value = '2026-04-16T00:00:00.000Z';
    assert.equal(schema.parse({ since: value }).since, value);
  });

  it('treats undefined, null and empty string as "no filter"', () => {
    for (const obj of [{}, { since: undefined }, { since: null }, { since: '' }]) {
      const parsed = schema.parse(obj);
      assert.equal(parsed.since, undefined, JSON.stringify(obj));
    }
  });

  it('rejects an unparseable value', () => {
    for (const since of ['yesterday', '2026-13-45', 'not-a-date']) {
      const result = schema.safeParse({ since });
      assert.equal(result.success, false, since);
      assert.equal(result.error.issues[0].message, 'bad timestamp');
    }
  });

  it('accepts anything Date.parse understands, including odd years', () => {
    // The guard is `!Number.isNaN(Date.parse(x))`, not "looks like an
    // ISO-8601 string". `Date.parse('12345')` resolves to a real instant
    // (year 12345), so it passes. That is a wide but harmless net: the
    // value is only ever used as a `created_at >= ?` bound, and a
    // syntactically valid-but-enormous date matches nothing rather than
    // erroring. Tightening this to a strict ISO check would be a
    // wire-contract change and is deliberately out of scope.
    const parsed = schema.parse({ since: '12345' });
    assert.equal(parsed.since, '12345');
  });

  it('rejects a non-string value instead of coercing it', () => {
    // Date.parse(12345) is NaN, but Date.parse(new Date()) is not — a
    // number or a Date object that slipped through as a "timestamp" must
    // not become a filter bound of the current time. Arrays are the one
    // deliberate exception: Express hands a repeated ?since= key over as
    // an array, and the first value wins (covered below).
    for (const since of [12345, {}, new Date()]) {
      const result = schema.safeParse({ since });
      assert.equal(result.success, false, String(since));
    }
  });

  it('takes the first value when the key is repeated', () => {
    // ?since=a&since=b reaches the handler as an array.
    const parsed = schema.parse({ since: ['2026-04-16T00:00:00.000Z', 'nonsense'] });
    assert.equal(parsed.since, '2026-04-16T00:00:00.000Z');
  });

  it('rejects a repeated key whose first value is malformed', () => {
    // Validating only the first element is deliberate (it is the one
    // Express would route into a handler), but "the first one is
    // checked" must not quietly mean "a bad first value is ignored".
    const result = schema.safeParse({ since: ['nonsense', '2026-04-16T00:00:00.000Z'] });
    assert.equal(result.success, false);
  });
});

describe('orderIdParam', () => {
  const schema = z.object({ id: orderIdParam() }).passthrough();

  it('accepts a uuid v4 as generated on the create path', () => {
    const id = require('uuid').v4();
    assert.equal(schema.safeParse({ id }).success, true);
  });

  it('accepts a non-uuid id, since orders are also created by VCC', () => {
    // A UUID pattern here would 400 on a perfectly valid row, turning a
    // schema change into an outage.
    assert.equal(schema.safeParse({ id: 'legacy_order_id-123' }).success, true);
  });

  it('rejects an empty id', () => {
    assert.equal(schema.safeParse({ id: '' }).success, false);
  });

  it('rejects an id at 257 characters and accepts one at 256', () => {
    assert.equal(schema.safeParse({ id: 'a'.repeat(257) }).success, false);
    assert.equal(schema.safeParse({ id: 'a'.repeat(256) }).success, true);
  });

  it('keeps sibling params, so a sub-route can add one', () => {
    // validate() assigns its parse output back onto req.params, so a
    // stripping object would drop anything a future sub-route declares.
    const result = schema.safeParse({ id: 'abc', view: 'full' });
    assert.equal(result.success, true);
    assert.equal(result.data.view, 'full');
  });
});

describe('boundedString with a minLength', () => {
  const schema = z.object({
    name: boundedString(4, 'name is required', 'name is too long', { minLength: 1 }),
  });

  it('treats a present-but-empty value as the same problem as a missing one', () => {
    // Inventing a third message here would mean the caller has to keep
    // it in sync, and the wire contract already says "required" for both.
    const result = schema.safeParse({ name: '' });
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, 'name is required');
  });

  it('keeps the empty-string case out of the length branch', () => {
    // Without the early return, an over-long value could also trip the
    // min check and report two issues for one problem.
    const result = schema.safeParse({ name: 'abcde' });
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].message, 'name is too long');
  });

  it('defaults to a minLength of 0, so "" is still allowed', () => {
    const open = z.object({ name: boundedString(4, 'bad type', 'too long') });
    assert.equal(open.safeParse({ name: '' }).success, true);
  });
});

describe('FulfillmentCard', () => {
  const valid = { number: '4111111111111111', cvv: '123', expiry: '12/27' };

  it('accepts the minimal shape', () => {
    assert.equal(FulfillmentCard.safeParse(valid).success, true);
  });

  it('treats brand as optional', () => {
    const result = FulfillmentCard.safeParse({ ...valid, brand: 'Visa' });
    assert.equal(result.success, true);
  });

  it('rejects a non-object', () => {
    assert.equal(FulfillmentCard.safeParse(null).success, false);
    assert.equal(FulfillmentCard.safeParse('4111111111111111').success, false);
  });

  it('requires number, cvv and expiry to be non-empty strings', () => {
    // These messages are part of the vcc-callback response contract and
    // must stay byte-identical to the inline schema they replaced.
    for (const field of ['number', 'cvv', 'expiry']) {
      for (const bad of ['', null, undefined, 7]) {
        const result = FulfillmentCard.safeParse({ ...valid, [field]: bad });
        assert.equal(result.success, false, `${field}=${JSON.stringify(bad)} should fail`);
        assert.equal(result.error.issues[0].message, `card.${field} is required`);
      }
    }
  });

  // The vault has no idea how long a PAN is, so an unbounded value would
  // be sealed verbatim and only discovered to be garbage on reveal.
  it('bounds every field that gets sealed', () => {
    for (const [field, overBy] of [
      ['number', 33],
      ['cvv', 9],
      ['expiry', 17],
      ['brand', 129],
    ]) {
      const result = FulfillmentCard.safeParse({ ...valid, [field]: 'x'.repeat(overBy) });
      assert.equal(result.success, false, `${field} should be bounded`);
    }
  });

  it('accepts a value sitting exactly on the cap', () => {
    assert.equal(FulfillmentCard.safeParse({ ...valid, number: '4'.repeat(32) }).success, true);
  });

  it('reports the offending field so the message names the problem', () => {
    const result = FulfillmentCard.safeParse({ ...valid, cvv: 'x'.repeat(9) });
    assert.equal(result.error.issues[0].path[0], 'cvv');
    assert.equal(result.error.issues[0].message, 'card.cvv is too long');
  });
});
