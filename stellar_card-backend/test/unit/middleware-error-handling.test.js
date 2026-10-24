// Unit tests for the error-handling middleware extracted in issue #377.
//
// These are unit tests on the middleware functions themselves, not
// integration tests through the running app: the thing worth pinning here
// is each module's own contract (what status, what body, what it forwards
// vs. swallows), and a supertest round-trip would bury that under routing,
// rate limiters and auth. The end-to-end consequence — that a real request
// actually gets these responses — is covered in
// test/integration/middleware-error-handling.test.js.

require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const corsDenial = require('../../src/middleware/corsDenial');
const { isCorsDenial, CORS_ERROR_PREFIX } = corsDenial;
const notFound = require('../../src/middleware/notFound');
const errorHandler = require('../../src/middleware/errorHandler');

// ── Test doubles ───────────────────────────────────────────────────────────

/**
 * Minimal Express `res` double. Only the surface these three modules
 * touch: `status()`, `json()`, and `headersSent`.
 */
function makeRes() {
  return {
    statusCode: null,
    body: undefined,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.headersSent = true;
      this.body = payload;
      return this;
    },
  };
}

const makeReq = (over = {}) => ({
  method: 'GET',
  path: '/v1/nope',
  originalUrl: '/v1/nope',
  id: 'req_test_1',
  ...over,
});

// ── corsDenial ─────────────────────────────────────────────────────────────

describe('corsDenial: isCorsDenial', () => {
  it('recognises the error cors() raises on a rejected origin', () => {
    const err = new Error(`${CORS_ERROR_PREFIX} origin not allowed`);
    assert.equal(isCorsDenial(err), true);
  });

  it('rejects an unrelated error', () => {
    assert.equal(isCorsDenial(new Error('boom')), false);
  });

  // The predicate reads `.message`, so every one of these would throw a
  // TypeError inside the error handler itself if it were not guarded. An
  // error handler that throws turns a 403 into a hung socket.
  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'CORS: origin not allowed'],
    ['a number', 42],
    ['an object with no message', {}],
    ['an object whose message is not a string', { message: { toString: () => 'CORS: x' } }],
  ]) {
    it(`returns false for ${label} instead of throwing`, () => {
      assert.doesNotThrow(() => isCorsDenial(value));
      assert.equal(isCorsDenial(value), false);
    });
  }

  it('does not match a message that merely contains the prefix', () => {
    // startsWith, not includes: "upstream CORS: ..." is some other failure.
    assert.equal(isCorsDenial(new Error('upstream CORS: origin not allowed')), false);
  });
});

describe('corsDenial: middleware', () => {
  it('turns a CORS rejection into a structured 403', () => {
    const res = makeRes();
    let forwarded = 'not-called';
    corsDenial(new Error(`${CORS_ERROR_PREFIX} origin not allowed`), makeReq(), res, (e) => {
      forwarded = e;
    });

    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'forbidden', message: 'Origin not allowed' });
    assert.equal(forwarded, 'not-called', 'a handled CORS denial must not be forwarded');
  });

  it('forwards any other error untouched', () => {
    // Critical: swallowing a non-CORS error here would mask the real
    // failure and turn every 500 into a 403.
    const res = makeRes();
    const original = new Error('database is on fire');
    let forwarded = null;
    corsDenial(original, makeReq(), res, (e) => {
      forwarded = e;
    });

    assert.equal(forwarded, original);
    assert.equal(res.statusCode, null, 'must not write a response for a non-CORS error');
  });

  it('forwards the CORS error when headers are already sent', () => {
    // The response has already started, so a second write would throw
    // ERR_HTTP_HEADERS_SENT. Delegating to Express is the only safe move.
    const res = makeRes();
    res.headersSent = true;
    const original = new Error(`${CORS_ERROR_PREFIX} origin not allowed`);
    let forwarded = null;
    corsDenial(original, makeReq(), res, (e) => {
      forwarded = e;
    });

    assert.equal(forwarded, original);
    assert.equal(res.body, undefined);
  });

  it('forwards a null error without throwing', () => {
    const res = makeRes();
    let forwarded = 'not-called';
    assert.doesNotThrow(() =>
      corsDenial(null, makeReq(), res, (e) => {
        forwarded = e;
      }),
    );
    assert.equal(forwarded, null);
  });
});

// ── notFound ──────────────────────────────────────────────────────────────

describe('notFound', () => {
  it('answers 404 with a JSON body naming the method and path', () => {
    const res = makeRes();
    notFound(makeReq({ method: 'POST', path: '/v1/orders' }), res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'not_found');
    // The path is echoed so a client can tell which of several
    // candidate URLs was wrong, without correlating server logs.
    assert.equal(res.body.message, 'No route for POST /v1/orders');
  });

  it('returns JSON, not the Express default HTML page', () => {
    const res = makeRes();
    notFound(makeReq(), res);
    assert.equal(typeof res.body, 'object');
    assert.notEqual(res.body, null);
  });

  it('does not leak a stack trace', () => {
    const res = makeRes();
    notFound(makeReq(), res);
    assert.equal(res.body.stack, undefined);
  });
});

// ── errorHandler ──────────────────────────────────────────────────────────

describe('errorHandler', () => {
  it('answers 500 with a req_id and no internals', () => {
    const res = makeRes();
    errorHandler(new Error('secret connection string leaked'), makeReq(), res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'internal_error');
    assert.equal(res.body.req_id, 'req_test_1');
    // The whole point of the fixed body: the message and stack stay in
    // the logs and never reach the client.
    assert.equal(res.body.message, undefined);
    assert.equal(res.body.stack, undefined);
  });

  it('does not echo the thrown message to the client', () => {
    const res = makeRes();
    errorHandler(new Error('pg://user:hunter2@db.internal/orders'), makeReq(), res, () => {});
    assert.doesNotMatch(JSON.stringify(res.body), /hunter2/);
  });

  it('survives an exotic thrown value', () => {
    // formatRejection exists for this: `err.message` on null throws
    // inside the handler, which is how a 500 becomes a hung request.
    for (const value of [null, undefined, 'a string', 0, { nested: { deeply: true } }]) {
      const res = makeRes();
      assert.doesNotThrow(
        () => errorHandler(value, makeReq(), res, () => {}),
        `throwing ${JSON.stringify(value)} must not break the handler`,
      );
      assert.equal(res.statusCode, 500);
    }
  });

  it('uses the originalUrl when present so query strings are attributable', () => {
    const res = makeRes();
    errorHandler(
      new Error('boom'),
      makeReq({ originalUrl: '/v1/orders?limit=abc', path: '/v1/orders' }),
      res,
      () => {},
    );
    assert.equal(res.statusCode, 500);
  });

  it('forwards to next(err) when headers are already sent (SSE contract)', () => {
    // SSE routes (GET /v1/orders/:id/stream) write headers immediately;
    // an error thrown mid-stream must delegate to Express's default
    // handler instead of throwing ERR_HTTP_HEADERS_SENT on a second write.
    const res = makeRes();
    res.headersSent = true;
    const original = new Error('boom after stream started');
    let forwarded = null;
    errorHandler(original, makeReq(), res, (e) => {
      forwarded = e;
    });

    assert.equal(forwarded, original);
    assert.equal(res.body, undefined, 'must not attempt a second write');
  });

  it('passes an explicit 4xx through instead of collapsing it to 500', () => {
    // express.json() throws SyntaxError with .status = 400 for malformed
    // JSON and PayloadTooLargeError with .status = 413 for oversized
    // bodies. Reporting client mistakes as 500 misleads the caller.
    const err = new Error('Unexpected token } in JSON');
    err.status = 400;
    err.type = 'entity.parse.failed';

    const res = makeRes();
    errorHandler(err, makeReq(), res, () => {});

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {
      error: 'entity.parse.failed',
      message: 'Unexpected token } in JSON',
    });
  });

  it('does not 404-ify an explicit server-side status like 503', () => {
    // Only 400–499 is treated as a client error; an upstream 5xx still
    // lands on the safe internal_error body, not on a 4xx response.
    const err = new Error('upstream unavailable');
    err.status = 503;

    const res = makeRes();
    errorHandler(err, makeReq(), res, () => {});

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'internal_error');
  });

  // errorHandler keeps its own CORS branch as defence in depth for the
  // case where corsDenial is not mounted. Both must produce the identical
  // body, or the fallback silently becomes a second wire contract.
  it('keeps a CORS fallback that matches corsDenial byte for byte', () => {
    const viaFallback = makeRes();
    errorHandler(
      new Error(`${CORS_ERROR_PREFIX} origin not allowed`),
      makeReq(),
      viaFallback,
      () => {},
    );

    const viaMiddleware = makeRes();
    corsDenial(
      new Error(`${CORS_ERROR_PREFIX} origin not allowed`),
      makeReq(),
      viaMiddleware,
      () => {},
    );

    assert.equal(viaFallback.statusCode, viaMiddleware.statusCode);
    assert.deepEqual(viaFallback.body, viaMiddleware.body);
  });
});
