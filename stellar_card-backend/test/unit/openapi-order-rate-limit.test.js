const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const openapi = require('../../openapi.json');

// #333: POST /v1/orders' rate limiter (orderCreateLimiter, src/api/orders.js)
// is fully implemented and tested — see test/unit/order-rate-limit.test.js
// ("Part 4") and test/integration/orders.test.js's "Part 5" suite — but the
// 429 it returns was never documented in the OpenAPI contract, so an API
// consumer reading openapi.json would have no idea order creation is
// rate-limited at all. This pins the fix so the contract can't silently
// drift out of sync with the real 429 behavior again.
describe('OpenAPI contract: POST /v1/orders rate limiting (#333)', () => {
  const responses = openapi.paths['/v1/orders'].post.responses;

  it('documents a 429 response', () => {
    assert.ok(responses['429'], 'POST /v1/orders must document its 429 response');
  });

  it('documents the real rate_limit_exceeded error shape returned by orderCreateLimiter', () => {
    const schema = responses['429'].content['application/json'].schema;
    assert.deepEqual(schema.properties.error.enum, ['rate_limit_exceeded']);
    assert.equal(schema.properties.message.type, 'string');
  });
});
