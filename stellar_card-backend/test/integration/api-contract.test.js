require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { request } = require('../helpers/app');

describe('public API contract', () => {
  it('returns JSON for unknown endpoints with a traceable request id', async () => {
    const res = await request.get('/does-not-exist').set('X-Request-ID', 'api-contract-test');

    assert.equal(res.status, 404);
    assert.equal(res.type, 'application/json');
    assert.deepEqual(res.body, {
      error: 'not_found',
      message: 'The requested endpoint does not exist.',
      req_id: 'api-contract-test',
    });
    assert.equal(res.headers['x-request-id'], 'api-contract-test');
  });

  it('advertises standard rate-limit headers on a public endpoint', async () => {
    const res = await request.get('/api/version');

    assert.equal(res.status, 200);
    assert.ok(res.headers.ratelimit, 'RateLimit header should be present');
  });

  it('uses the standardized error body for a rejected CORS origin', async () => {
    const res = await request.get('/api/version').set('Origin', 'https://untrusted.example');

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'forbidden');
    assert.equal(res.body.message, 'Origin not allowed');
    assert.ok(res.body.req_id);
  });
});
