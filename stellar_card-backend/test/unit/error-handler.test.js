require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const errorHandler = require('../../src/middleware/errorHandler');

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    getHeader: () => undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe('standard error handler', () => {
  it('preserves exposed client errors in the shared response shape', () => {
    const res = responseDouble();
    errorHandler(
      Object.assign(new Error('amount must be positive'), {
        status: 422,
        code: 'invalid_amount',
      }),
      { id: 'req-client', method: 'POST', path: '/v1/orders' },
      res,
      () => {},
    );

    assert.equal(res.statusCode, 422);
    assert.deepEqual(res.body, {
      error: 'invalid_amount',
      message: 'amount must be positive',
      req_id: 'req-client',
    });
  });

  it('does not leak internal exception details', () => {
    const res = responseDouble();
    errorHandler(
      new Error('database password appeared here'),
      { id: 'req-server', method: 'GET', path: '/boom' },
      res,
      () => {},
    );

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: 'internal_error', req_id: 'req-server' });
  });

  it('returns the same correlation field for CORS failures', () => {
    const res = responseDouble();
    errorHandler(
      new Error('CORS: origin not allowed'),
      { id: 'req-cors', method: 'GET', path: '/' },
      res,
      () => {},
    );

    assert.deepEqual(res.body, {
      error: 'forbidden',
      message: 'Origin not allowed',
      req_id: 'req-cors',
    });
  });
});
