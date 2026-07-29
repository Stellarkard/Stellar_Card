const { it } = require('node:test');
const assert = require('node:assert/strict');
const rateLimitHandler = require('../../src/middleware/rateLimitHandler');

it('returns a consistent, traceable rate-limit response', () => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  rateLimitHandler('Slow down.')({ id: 'req-rate-limit' }, response);

  assert.equal(response.statusCode, 429);
  assert.deepEqual(response.body, {
    error: 'too_many_requests',
    message: 'Slow down.',
    req_id: 'req-rate-limit',
  });
});
