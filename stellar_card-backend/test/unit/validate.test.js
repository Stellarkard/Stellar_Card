// Unit tests for src/middleware/validate.js (Issue #27).
//
// No DB / Express server needed — validateBody() only touches req.body,
// res.status().json(), and next(), so it's exercised directly with mock
// objects rather than spinning up a full app.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const { validateBody } = require('../../src/middleware/validate');

function mockRes() {
  const res = {
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
  return res;
}

const schema = z.object({
  email: z.string().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'A valid email address is required.'),
});

describe('validateBody', () => {
  it('rejects an array body with 400 invalid_request by default', () => {
    const req = { body: [{ email: 'a@b.com' }] };
    const res = mockRes();
    let nextCalled = false;
    validateBody(schema)(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_request');
    assert.equal(nextCalled, false);
  });

  it('rejects a missing body with 400 invalid_request', () => {
    const req = { body: undefined };
    const res = mockRes();
    validateBody(schema)(req, res, () => {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_request');
  });

  it('rejects a null body value with 400 invalid_request', () => {
    const req = { body: null };
    const res = mockRes();
    validateBody(schema)(req, res, () => {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_request');
  });

  it('uses fieldErrorCode for schema validation failures, not bodyErrorCode', () => {
    const req = { body: {} };
    const res = mockRes();
    validateBody(schema, { fieldErrorCode: 'invalid_email' })(req, res, () => {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_email');
  });

  it('rejects a field with the wrong type (array instead of string)', () => {
    const req = { body: { email: ['a@b.com'] } };
    const res = mockRes();
    validateBody(schema, { fieldErrorCode: 'invalid_email' })(req, res, () => {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_email');
  });

  it('rejects a value that fails the schema regex', () => {
    const req = { body: { email: 'not-an-email' } };
    const res = mockRes();
    validateBody(schema, { fieldErrorCode: 'invalid_email' })(req, res, () => {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_email');
  });

  it('calls next() and replaces req.body with the parsed value on success', () => {
    const req = { body: { email: 'user@example.com' } };
    const res = mockRes();
    let nextCalled = false;
    validateBody(schema)(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
    assert.deepEqual(req.body, { email: 'user@example.com' });
  });

  it('supports custom bodyErrorCode / bodyErrorMessage overrides', () => {
    const req = { body: 'not-an-object' };
    const res = mockRes();
    validateBody(schema, {
      bodyErrorCode: 'custom_shape_error',
      bodyErrorMessage: 'custom message',
    })(req, res, () => {});
    assert.equal(res.body.error, 'custom_shape_error');
    assert.equal(res.body.message, 'custom message');
  });
});
